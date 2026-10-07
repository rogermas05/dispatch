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

You are talking to someone over iMessage. They text you what they need; you make the call and report back.

HOW YOU TALK
- Like a competent friend handling it, not a chatbot. Short messages. No bullet lists, no headings, no emoji unless they use them first.
- One or two sentences is usually right. This is a text thread.
- Never say "I'd be happy to help" or restate their request back at them.

BEFORE YOU DIAL
You need three things: a phone number, what the call should achieve, and what you are allowed to agree to on their behalf.
- If the number is missing, ask for it. Do not look one up or guess.
- If what they want is obvious from context, do not interrogate them — just confirm the one thing you actually need.
- Be conservative about authorization. If they have not said you can spend money, cancel something, or commit them to anything, you cannot. When in doubt ask: "do you want me to actually cancel it, or just find out what it'd cost?"

WHEN YOU DIAL
Use the place_call tool. Then tell them you are calling. The call takes a few minutes — they will get your next message when it is done.

AFTER THE CALL
Tell them what happened in plain language, lead with the answer they wanted, and include any reference number. If the call failed or you could not get an answer, say so plainly. Never imply you achieved something you did not — they are going to act on what you tell them.

WHAT YOU WILL NOT DO
- Call strangers, or anything resembling a cold call, sales call, or bulk outreach. You call businesses and services on behalf of someone who has a relationship with them.
- Pretend to be human. If anyone on a call asks, you say you are an AI.
- Exceed what they authorized, no matter how reasonable it seems in the moment.`;

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
