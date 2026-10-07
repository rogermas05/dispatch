import Anthropic from '@anthropic-ai/sdk';
import type { CallProvider } from '../../worker/src/call/provider.ts';
import { quoteCall, payAndRun, type Quote } from './paid-call.js';
import { parseAllowlist } from '../../worker/src/lib/allowlist.ts';
import { centsForQuote, dollars, type Billing } from './payments.js';

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

MAKING THE CALL
Once you have the number and know what they want, just go — say you're sending your Sokosumi agent and use place_call. Don't ask them to confirm a price first; it's cents, and they'll see the number as it goes.

You'll get the price and a "payment locked" update automatically while it runs. Don't repeat them.

AFTER
Lead with what they wanted to know. If you got an answer, give it: "he said black". Add a reference number if there is one.

If it failed, say so straight, and tell them they weren't charged — the payment sits in escrow and refunds automatically when a call doesn't deliver. Never imply it worked.

WHAT YOU WON'T DO
Cold calls, sales calls, or anything in bulk. You call people and places on behalf of someone with a reason to contact them.
Pretend to be human on a call. If asked, you say you're an AI.
Go past what they authorized, however sensible it seems in the moment.

MONEY
If payments are on, they pay for calls from a prepaid balance. When they ask to top up, add money, or for a payment link, use send_top_up_link — the link goes out as its own message, so just say it's there.

This is a test setup — the only number reachable is the one texting you. Silly requests are fine. Don't lecture, don't refuse things for being pointless.`;



const TOOLS: Anthropic.Tool[] = [
	{
		name: 'place_call',
		description:
			'Price and place a real phone call. Quotes the job, locks the funds in escrow, dials, and returns the outcome. Takes a couple of minutes. Only call this once you have a number, a clear objective, and know what you are authorized to agree to.',
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
				on_behalf_of: {
					type: 'string',
					description:
						"Who the call is for, phrased as the person answering would recognise them — the requester's name, or their relationship to the answerer if the request makes it clear.",
				},
				context: { type: 'string', description: 'Facts needed on the call: account numbers, names, dates' },
			},
			required: ['to', 'objective', 'authorization'],
		},
	},
];

/** Only offered when payments are on; without a balance there is nothing to top up. */
const TOP_UP_TOOL: Anthropic.Tool = {
	name: 'send_top_up_link',
	description:
		'Text them a Stripe payment link to add funds to their prepaid balance. Use when they ask to top up, add money, or for a payment link. Returns their current balance.',
	input_schema: { type: 'object', properties: {} },
};

export interface Conversation {
	messages: Anthropic.MessageParam[];
	/** Quotes given but not yet accepted, by job id. They expire at payByTime. */
	quotes?: Map<string, Quote>;
}

export interface AgentDeps {
	provider: CallProvider;
	/** Sends an interim message while a call is running. */
	notify: (text: string) => Promise<void>;
	/** The sender's prepaid balance. Absent when payments are off and calls are free. */
	billing?: Billing;
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
			tools: deps.billing ? [...TOOLS, TOP_UP_TOOL] : TOOLS,
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

		const said = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
		const result =
			toolUse.name === TOP_UP_TOOL.name && deps.billing
				? await sendTopUp(deps.billing)
				: await placeCall(toolUse, said, deps);

		convo.messages.push({
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: result }],
		});
	}
	return "Something went wrong on my end and I couldn't finish that. Try again?";
}

async function sendTopUp(billing: Billing): Promise<string> {
	try {
		await billing.sendTopUpLink();
		return `SENT: a payment link was just texted to them as its own message. Their balance is ${dollars(billing.balanceCents())}. Tell them in one line to tap it, and that you'll text when the money lands.`;
	} catch (err) {
		return `The payment link could not be created: ${err instanceof Error ? err.message : String(err)}. Tell them plainly and to try again in a bit.`;
	}
}

async function placeCall(toolUse: Anthropic.ToolUseBlock, said: string, deps: AgentDeps): Promise<string> {
	const args = toolUse.input as {
		to: string;
		objective: string;
		authorization: string;
		context?: string;
		on_behalf_of?: string;
	};

	if (allowed && !allowed.has(args.to)) {
		// Refused before quoting, not after. The allowlist is what separates a
		// demo from an accidental robocall.
		return `REFUSED: ${args.to} is not on the allowed-numbers list, so nothing was quoted and no call was placed. Tell them you can only call approved numbers right now.`;
	}

	const billing = deps.billing;
	if (said) await deps.notify(said);
	try {
		// Quote and accept in one go. Splitting them across two messages was
		// a turn of friction for a price measured in cents; the number is
		// still said out loud before any money moves.
		// His billing path, plus onBehalfOf so the greeting still opens with
		// who the call is for rather than what is on the other end.
		const quote = await quoteCall({ ...args, onBehalfOf: args.on_behalf_of });
		return billing
			? await chargeAndRun(quote, billing, toolUse.id, deps.notify)
			: await run(quote, deps.notify);
	} catch (err) {
		billing?.refund(toolUse.id);
		return `The call failed: ${err instanceof Error ? err.message : String(err)}. Tell them plainly, and that they are not charged for a call that did not happen.`;
	}
}

/**
 * Take the quoted price from the sender's balance before escrow locks anything.
 * Short balance: nothing is charged and they get a top-up link. A call that
 * does not complete is refunded, matching the escrow refund we get back.
 */
async function chargeAndRun(quote: Quote, billing: Billing, jobKey: string, notify: (text: string) => Promise<void>): Promise<string> {
	const priceCents = centsForQuote(quote.priceUsdm);
	if (!billing.charge(jobKey, priceCents)) {
		await billing.sendTopUpLink(priceCents - billing.balanceCents());
		return `NOT PLACED: this call costs ${dollars(priceCents)} and their balance is ${dollars(billing.balanceCents())}, so nothing was charged and no call was made. A payment link was just texted to them as its own message. Tell them in one line what it costs, to tap the link to add funds, and that you will make the call once it lands.`;
	}
	await notify(`${dollars(priceCents)}, taking it from your balance (${dollars(billing.balanceCents())} left)`);
	const result = await pay(quote, notify);
	if (!result.completed) billing.refund(jobKey);
	return result.text;
}

async function run(quote: Quote, notify: (text: string) => Promise<void>): Promise<string> {
	if (quote.priceUsdm) await notify(`${quote.priceUsdm} tUSDM — locking it in now.`);
	return (await pay(quote, notify)).text;
}

async function pay(quote: Quote, notify: (text: string) => Promise<void>): Promise<{ completed: boolean; text: string }> {
	const paid = await payAndRun(quote, { onFundsLocked: () => notify('payment locked, calling now') });
	return {
		completed: paid.status === 'completed',
		text: JSON.stringify({
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
		}),
	};
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
