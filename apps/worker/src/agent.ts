import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { CallProvider } from './call/provider.js';
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

const briefSchema = z.object({
	to: z.string().min(3),
	objective: z.string().min(1),
	authorization: z.string(),
	context: z.record(z.string()).optional(),
	maxDurationSeconds: z.number().int().positive().max(1800),
});

const outcomeSchema = z.object({
	summary: z.string(),
	artifacts: z.record(z.string()),
	humanFollowUp: z.string().nullable(),
	caveats: z.array(z.string()),
});

function client(): Anthropic {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
	return new Anthropic({ apiKey });
}

async function structured<T>(prompt: string, system: string, schema: z.ZodType<T>): Promise<T> {
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

Return ONLY a JSON object: {summary, artifacts, humanFollowUp, caveats}.

- "summary" is one or two sentences on whether the objective was met.
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
): Promise<CallOutcome> {
	const brief = await parseBrief(task.name, task.description);
	const result = await provider.place(brief);
	return reportOutcome(brief, result);
}
