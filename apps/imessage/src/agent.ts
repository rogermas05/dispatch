import Anthropic from '@anthropic-ai/sdk';
import type { CallProvider } from '../../worker/src/call/provider.ts';
import { quoteCall, payAndRun, type Quote } from './paid-call.js';
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

const SYSTEM = `You're Dispatch. You make phone calls for people who don't want to make them.

You're texting with someone. They tell you what they need, you get it done, you tell them how it went.

HOW YOU TEXT
Like a friend who's handling it. Short. Lowercase is fine. No bullet points, no headings, no "I'd be happy to help", no restating what they just said back at them.

Usually one line. "yeah I can do that, what's the number?" is a better message than three sentences of structure.

Don't explain yourself unless asked. Don't add disclaimers. Don't thank them for their patience.

BEFORE YOU CALL
You need a number, what the call is for, and what you're allowed to agree to.

If you don't have the number, ask. Never guess one.
If the rest is obvious, don't interrogate them — just go.
Don't agree to spend money, cancel things, or commit them to anything unless they said so. If it actually matters, ask: "just asking, or do you want me to actually cancel it?"

QUOTE FIRST, THEN CALL
Two steps, always.

1. get_quote — prices it. Nothing is charged, nothing is dialed. Then tell them the number plainly: "ok it's 0.2 tUSDM for that, want me to?" Keep it casual, it's cents.
2. accept_quote — only after they say yes. That locks the money and sends your Sokosumi agent.

If they say no, drop it. The quote just expires, nothing is spent. Don't push.
If they already said "yes do it" before seeing a price, still quote first and tell them — then go straight into accepting it, no second question.

You'll get a "payment locked" update automatically while it runs. Don't repeat it.

AFTER
Lead with what they wanted to know. If you got an answer, give it: "he said black". Add a reference number if there is one.

If it failed, say so straight, and tell them they weren't charged — the payment sits in escrow and refunds automatically when a call doesn't deliver. Never imply it worked.

WHAT YOU WON'T DO
Cold calls, sales calls, or anything in bulk. You call people and places on behalf of someone with a reason to contact them.
Pretend to be human on a call. If asked, you say you're an AI.
Go past what they authorized, however sensible it seems in the moment.

This is a test setup — the only number reachable is the one texting you. Silly requests are fine. Don't lecture, don't refuse things for being pointless.`;



const TOOLS: Anthropic.Tool[] = [
	{
		name: 'get_quote',
		description:
			'Price a call without paying for it. Returns the exact cost. Nothing is charged and no call is placed — use this first, tell them the price, and wait for a yes.',
		input_schema: {
			type: 'object',
			properties: {
				to: { type: 'string', description: 'Number to dial in E.164 format, e.g. +14155550123' },
				objective: { type: 'string', description: 'What this call must achieve, in plain language' },
				authorization: {
					type: 'string',
					description:
						'Exactly what you may agree to on their behalf. Be conservative — only what they actually granted.',
				},
				context: { type: 'string', description: 'Facts needed on the call: account numbers, names, dates' },
			},
			required: ['to', 'objective', 'authorization'],
		},
	},
	{
		name: 'accept_quote',
		description:
			'Accept the quote you were just given: locks the funds in escrow and places the call. Only use this after they have agreed to the price. Takes a few minutes.',
		input_schema: {
			type: 'object',
			properties: { quote_id: { type: 'string', description: 'The quote_id from get_quote' } },
			required: ['quote_id'],
		},
	},
];

export interface Conversation {
	messages: Anthropic.MessageParam[];
	/** Quotes given but not yet accepted, by job id. They expire at payByTime. */
	quotes?: Map<string, Quote>;
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

		let result: string;

		if (toolUse.name === 'get_quote') {
			const args = toolUse.input as { to: string; objective: string; authorization: string; context?: string };
			if (allowed && !allowed.has(args.to)) {
				result = `REFUSED: ${args.to} is not on the allowed-numbers list. Nothing was quoted and no call was placed. Tell them you can only call approved numbers right now.`;
			} else {
				try {
					const quote = await quoteCall(args);
					(convo.quotes ??= new Map()).set(quote.jobId, quote);
					result = JSON.stringify({
						quote_id: quote.jobId,
						price_usdm: quote.priceUsdm,
						expires_at: new Date(quote.payByTime).toISOString(),
						note: 'Nothing is charged yet. Tell them the price and wait for a yes before calling accept_quote.',
					});
				} catch (err) {
					result = `Could not get a quote: ${err instanceof Error ? err.message : String(err)}. Say so plainly.`;
				}
			}
		} else {
			const { quote_id } = toolUse.input as { quote_id: string };
			const quote = convo.quotes?.get(quote_id);
			if (!quote) {
				result = 'No such quote. Get a fresh one with get_quote before calling.';
			} else {
				const said = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
				if (said) await deps.notify(said);
				try {
					const paid = await payAndRun(quote, {
						onFundsLocked: () => deps.notify('payment locked, calling now'),
					});
					convo.quotes?.delete(quote_id);
					result = JSON.stringify({
						jobStatus: paid.status,
						priceUsdm: paid.priceUsdm,
						jobId: paid.jobId,
						outputHash: paid.outputHash,
						result: paid.result,
						...(paid.status === 'failed'
							? {
									error: paid.error,
									billing:
										'The call did not complete, so no result hash was submitted and the escrow refunds automatically when the deadline passes. Tell them plainly that it failed and that they are not being charged.',
								}
							: {}),
					});
				} catch (err) {
					result = `The call failed: ${err instanceof Error ? err.message : String(err)}. Tell them plainly and that they are not charged for a call that did not happen.`;
				}
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
