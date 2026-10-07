import Anthropic from '@anthropic-ai/sdk';
import type { CallProvider } from '../../worker/src/call/provider.ts';
import { runBrief } from '../../worker/src/agent.ts';
import { parseAllowlist } from '../../worker/src/lib/allowlist.ts';

/**
 * The texting half of Dispatch.
 *
 * Someone texts "call my pharmacy and see if my refill is ready"; this decides
 * whether it has enough to dial, asks if it does not, places the call with the
 * same code the paid agent uses, and texts back what happened.
 *
 * It deliberately runs the real call path rather than a parallel one. A second
 * implementation would drift, and the authorization text it assembles is the
 * text that gets hashed on-chain when the same brief arrives through a paid job.
 */

const MODEL = process.env.MODEL_ID ?? 'claude-sonnet-5-5';
const MAX_TURNS = 12;

const SYSTEM = `You are Dispatch — an agent that makes phone calls for people who do not want to make them.

You are a registered agent on the Sokosumi marketplace, paid per call in USDM on Cardano. A call costs about 50 cents.

You are talking to someone over iMessage. They text you what they need; you make the call and report back.

HOW YOU TALK
- Like a competent friend handling it. Short messages. No bullet lists, no headings, no emoji unless they use them first.
- One or two sentences is usually right. This is a text thread.
- Never say "I'd be happy to help", never restate their request back at them, never explain your own capabilities unless asked.

CONFIRMING BEFORE YOU DIAL
Once you know who to call and what for, confirm in one line that names the Sokosumi agent and the price, then wait for a yes:
"Got it — I'll use my Sokosumi agent to call him and ask. It'll be about 50 cents, just making sure you're cool with it?"
"Sure — my Sokosumi agent can call them. Runs about 50 cents, good to go?"
Say "my Sokosumi agent" rather than "I" for the dialing itself: you are the one texting, the registered agent on the marketplace is the one placing the call, and it is paid per call on Cardano. If they already said go, or they are clearly impatient, just dial — do not ask twice.

WHAT YOU NEED
A phone number, what the call should achieve, and what you may agree to on their behalf.
- Missing number: ask for it. Never guess or look one up.
- If the rest is obvious from context, do not interrogate them.
- Be conservative about authorization: no spending, cancelling or committing unless they said so. When it matters, ask — "actually cancel it, or just find out what it'd cost?"

DEFAULT TO DOING IT
This is a test deployment and the only number you can dial belongs to the person texting you. Casual, silly and self-directed requests are all fine — asking a friend their favourite colour is a perfectly good call. Do not lecture, do not refuse for being pointless, and do not add disclaimers nobody asked for. If the system refuses a number, say so plainly in one line and move on.

AFTER THE CALL
Lead with the answer they wanted. Plain language, include any reference number. If it failed or you could not get an answer, say that straight — they are going to act on what you tell them, so never imply you achieved something you did not.

THE ACTUAL LIMITS
- No cold calls, sales calls, or bulk outreach. You call people and businesses on behalf of someone with a reason to contact them.
- Never pretend to be human. If asked on a call, you say you are an AI.
- Never exceed what they authorized, however reasonable it seems in the moment.`;


const TOOLS: Anthropic.Tool[] = [
	{
		name: 'place_call',
		description:
			'Place a real phone call and return the outcome. Takes a few minutes. Only call this when you have a number, a clear objective, and know what you are authorized to agree to.',
		input_schema: {
			type: 'object',
			properties: {
				to: { type: 'string', description: 'Number to dial in E.164 format, e.g. +14155550123' },
				objective: { type: 'string', description: 'What this call must achieve, in plain language' },
				authorization: {
					type: 'string',
					description:
						'Exactly what you may agree to on their behalf. Be conservative — include only what they actually granted. If they granted nothing, say so.',
				},
				context: { type: 'string', description: 'Facts you may need on the call: account numbers, names, dates' },
			},
			required: ['to', 'objective', 'authorization'],
		},
	},
];

export interface Conversation {
	messages: Anthropic.MessageParam[];
}

export interface AgentDeps {
	provider: CallProvider;
	/** Sends an interim message while a call is running. */
	notify: (text: string) => Promise<void>;
}

const allowed = parseAllowlist(process.env.DISPATCH_ALLOWED_NUMBERS);

export async function respond(convo: Conversation, userText: string, deps: AgentDeps): Promise<string> {
	const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
	convo.messages.push({ role: 'user', content: userText });

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		const res = await client.messages.create({
			model: MODEL,
			max_tokens: 1024,
			system: SYSTEM,
			tools: TOOLS,
			messages: convo.messages,
		});
		convo.messages.push({ role: 'assistant', content: res.content });

		const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
		if (!toolUse) {
			return res.content
				.filter((b): b is Anthropic.TextBlock => b.type === 'text')
				.map((b) => b.text)
				.join('')
				.trim();
		}

		const args = toolUse.input as { to: string; objective: string; authorization: string; context?: string };
		let result: string;

		if (allowed && !allowed.has(args.to)) {
			// Refused before dialing, not after. The allowlist is what separates a
			// demo from an accidental robocall.
			result = `REFUSED: ${args.to} is not on the allowed-numbers list, so no call was placed. Tell the user you can only call approved numbers right now.`;
		} else {
			const said = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
			await deps.notify(said || `Calling ${args.to} now — I'll text you when it's done.`);
			try {
				// runBrief re-checks the allowlist after parsing the brief, which is
				// the authoritative gate. The check above is only so the refusal
				// reads like a sentence instead of an exception.
				const outcome = await runBrief(
					{ name: 'iMessage request', description: briefText(args) },
					deps.provider,
					allowed,
				);
				result = JSON.stringify({
					status: outcome.status,
					summary: outcome.summary,
					artifacts: outcome.artifacts,
					humanFollowUp: outcome.humanFollowUp,
					caveats: outcome.caveats,
					transcript: outcome.transcript.text.slice(0, 4000),
				});
			} catch (err) {
				result = `The call failed before completing: ${err instanceof Error ? err.message : String(err)}. Tell the user plainly; do not invent an outcome.`;
			}
		}

		convo.messages.push({
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: result }],
		});
	}
	return "Something went wrong on my end and I couldn't finish that. Try again?";
}

/** The same brief shape the paid path parses, so one code path handles both. */
function briefText(a: { to: string; objective: string; authorization: string; context?: string }): string {
	return [
		`Call ${a.to}.`,
		`Objective: ${a.objective}`,
		`Authorization: ${a.authorization}`,
		a.context ? `Context: ${a.context}` : '',
	]
		.filter(Boolean)
		.join('\n');
}
