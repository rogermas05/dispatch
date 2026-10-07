import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { CallProvider } from './call/provider.js';
import { NumberNotAllowedError } from './lib/allowlist.js';
import type { CallBrief, CallOutcome, CallResult } from './lib/types.js';

/**
 * The agent: turn a task description into a call, then a call into a deliverable.
 *
 * Two model passes bracket the call. The first reads the buyer's free-text brief
 * into a structured one — crucially including the authorization, which is the
 * text whose hash goes on-chain and therefore the record of what we were allowed
 * to do. The second reads the transcript into an outcome a buyer (or a calling
 * agent) can act on.
 *
 * The model never decides whether to dial. That gate is the escrow state.
 */

const MODEL = process.env.MODEL_ID ?? 'claude-sonnet-5-5';

/**
 * Tolerant on shape, strict on meaning.
 *
 * A model asked for a record will sometimes return a prose string, and rejecting
 * the whole brief over that would fail a job whose actual content was fine. The
 * fields that matter — the number and the authorization — stay strict.
 */
const briefSchema = z.object({
	to: z.string().min(3),
	objective: z.string().min(1),
	authorization: z.string(),
	context: z
		.union([z.record(z.string()), z.string(), z.null()])
		.optional()
		.transform((v) => (typeof v === 'string' ? (v.trim() ? { notes: v } : undefined) : (v ?? undefined))),
	maxDurationSeconds: z.coerce.number().int().positive().max(1800).default(900),
});

const outcomeSchema = z.object({
	summary: z.string(),
	// Models return numbers, nested objects and nulls here. The values are for a
	// human to read, so coerce rather than fail a completed call over formatting.
	artifacts: z
		.union([z.record(z.unknown()), z.null()])
		.optional()
		.transform((v) =>
			Object.fromEntries(
				Object.entries(v ?? {})
					.filter(([, x]) => x !== null && x !== undefined && x !== '')
					.map(([k, x]) => [k, typeof x === 'string' ? x : JSON.stringify(x)]),
			),
		),
	humanFollowUp: z.string().nullable().optional().transform((v) => v ?? null),
	caveats: z
		.union([z.array(z.unknown()), z.string(), z.null()])
		.optional()
		.transform((v) =>
			typeof v === 'string' ? [v] : (v ?? []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))),
		),
	// Same tolerance: a missing or stringly answer must not fail a finished call.
	objectiveMet: z
		.union([z.boolean(), z.string(), z.null()])
		.optional()
		.transform((v) => v === true || v === 'true'),
});

const researchQuestionSchema = z.object({
	question: z
		.union([z.string(), z.null()])
		.optional()
		.transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : null)),
});

function client(): Anthropic {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
	return new Anthropic({ apiKey });
}

async function structured<S extends z.ZodTypeAny>(prompt: string, system: string, schema: S): Promise<z.output<S>> {
	const res = await client().messages.create({
		model: MODEL,
		max_tokens: 2048,
		system,
		messages: [{ role: 'user', content: prompt }],
	});
	const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
	const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
	return schema.parse(JSON.parse(json));
}

const PARSE_SYSTEM = `You convert a buyer's free-text request into a structured phone-call brief.

Return ONLY a JSON object: {to, objective, authorization, context, maxDurationSeconds}.

- "to" is an E.164 phone number taken from the request. Never invent one.
- "objective" is what the call must achieve, in plain language.
- "authorization" is what the caller may commit to on the buyer's behalf. Be
  conservative: include only what the request actually grants. If the request
  grants nothing explicit, say so plainly. This text is hashed on-chain and is
  the record of what we were permitted to do, so it must not overstate.
- "context" holds facts the caller may need (account numbers, names, dates).
- "maxDurationSeconds" is a sane ceiling; default 900.`;

const REPORT_SYSTEM = `You turn a phone call transcript into a deliverable.

Return ONLY a JSON object: {summary, artifacts, humanFollowUp, caveats, objectiveMet}.

- "summary" is one or two sentences on whether the objective was met.
- "objectiveMet" is true only if the transcript shows the objective was achieved.
- "artifacts" holds reference numbers, confirmation codes, names and commitments
  obtained. This is what makes the call reusable by whoever comes next.
- "humanFollowUp" is what a person still has to do, or null.
- "caveats" states what this call does NOT establish. The other party may have
  been wrong or may not honour what they said; a transcript proves what was said,
  never that it was true. Say so when it matters.

Report only what the transcript supports. Never infer an outcome that is not in it.`;

export async function parseBrief(taskName: string, taskDescription: string): Promise<CallBrief> {
	return structured(
		`Task title: ${taskName}\n\nTask description:\n${taskDescription}`,
		PARSE_SYSTEM,
		briefSchema,
	);
}

export async function reportOutcome(brief: CallBrief, result: CallResult): Promise<CallOutcome> {
	// A call that never connected has nothing to summarize; asking a model to
	// narrate silence invites it to invent one.
	if (result.status === 'unreachable' || result.transcript.turns.length === 0) {
		return {
			...result,
			summary: `Call to ${brief.to} did not connect (${result.status}). The objective was not pursued.`,
			artifacts: {},
			objectiveMet: false,
			humanFollowUp: `Retry the call to ${brief.to}, or confirm the number is correct.`,
			caveats: ['No conversation took place. Nothing about the objective was established.'],
		};
	}

	const report = await structured(
		`Objective: ${brief.objective}\nAuthorization granted: ${brief.authorization}\n` +
			`Call status: ${result.status}, duration ${result.durationSeconds}s\n\nTranscript:\n${result.transcript.text}`,
		REPORT_SYSTEM,
		outcomeSchema,
	);
	return { ...result, ...report };
}

/** Full job: brief in, outcome out. */
export async function runBrief(
	task: { name: string; description: string },
	provider: CallProvider,
	/** Numbers Dispatch may dial; null only for the mock provider. Checked after parsing, before dialing. */
	allowedNumbers: ReadonlySet<string> | null,
): Promise<CallOutcome> {
	const brief = await parseBrief(task.name, task.description);
	if (allowedNumbers && !allowedNumbers.has(brief.to)) throw new NumberNotAllowedError(brief.to);
	const result = await provider.place(brief);
	return reportOutcome(brief, result);
}

const RESEARCH_SYSTEM = `You prepare a phone call that an AI agent is about to place for a client.

Return ONLY a JSON object: {question}.

Decide whether ONE piece of background research would materially change how the
call goes: the right department or procedure, the relevant policy or rule, typical
timelines, what a reasonable outcome looks like. If so, write that question so a
research agent with web access can answer it in a few paragraphs, citing sources.
Never ask it to contact anyone, and never include account numbers or personal data
from the brief. If research would not change the call, return {"question": null}.`;

/** The single research question worth paying for before this call, or null if none. */
export async function planResearch(brief: CallBrief): Promise<string | null> {
	const out = await structured(`Objective: ${brief.objective}\nAuthorization: ${brief.authorization}`, RESEARCH_SYSTEM, researchQuestionSchema);
	return out.question;
}

const SYNTHESIS_SYSTEM = `You combine several phone calls placed for one job into one deliverable.

Return ONLY a JSON object: {summary, artifacts, humanFollowUp, caveats, objectiveMet}.

- When the calls were to different businesses for comparison, compare what each
  offered (prices, dates, terms) and say which best meets the objective.
- When the calls were attempts in sequence, say which call achieved the objective
  or why none did.
- "artifacts" keeps every reference number, quote and commitment, labelled by call.
- Report only what the call reports support. Never infer an outcome not in them.`;

export type Synthesis = Pick<CallOutcome, 'summary' | 'artifacts' | 'humanFollowUp' | 'caveats'> & { objectiveMet: boolean };

/** Merge the per-call outcomes of a multi-call job into one deliverable. */
export async function synthesizeOutcomes(
	objective: string,
	plan: 'compare' | 'until_resolved',
	calls: Array<{ to: string; outcome: CallOutcome }>,
): Promise<Synthesis> {
	const reports = calls
		.map((c, i) => `Call ${i + 1} to ${c.to} (${c.outcome.status}): ${c.outcome.summary}\nArtifacts: ${JSON.stringify(c.outcome.artifacts)}`)
		.join('\n\n');
	return structured(`Objective: ${objective}\nPlan: ${plan}\n\n${reports}`, SYNTHESIS_SYSTEM, outcomeSchema);
}
