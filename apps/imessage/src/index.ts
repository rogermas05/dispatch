import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { BlueBubbles, parseInbound, type InboundMessage } from './bluebubbles.js';
import { respond, type Conversation } from './agent.js';
import { selectProvider } from '../../worker/src/call/select.ts';
import { Ledger } from './ledger.js';
import { CANCELLED_PATH, loadPaymentsConfig, PAID_PATH, Payments, STRIPE_WEBHOOK_PATH, dollars } from './payments.js';
import { StripeClient } from './stripe.js';

/**
 * Dispatch over iMessage.
 *
 * BlueBubbles posts inbound messages here; we reply in the same thread. One
 * conversation per chat, held in memory — a restart loses context, which for a
 * text thread is an acceptable trade for not running a database.
 */

const PORT = Number(process.env.IMESSAGE_BOT_PORT ?? 8787);
const BB_URL = process.env.BLUEBUBBLES_URL ?? 'http://localhost:1234';
const BB_PASSWORD = process.env.BLUEBUBBLES_PASSWORD ?? '';

/**
 * Inbound messages are trusted for who sent them, and with payments on this
 * server is reachable from the internet (Stripe has to post to it). So the
 * BlueBubbles webhook lives at a path only BlueBubbles is told.
 */
const BB_WEBHOOK_PATH = `/webhook/${createHash('sha256').update(`dispatch-webhook:${BB_PASSWORD}`).digest('hex').slice(0, 32)}`;

const bb = new BlueBubbles(BB_URL, BB_PASSWORD);
const provider = selectProvider();
const conversations = new Map<string, Conversation>();
/** Message guids already handled — BlueBubbles can deliver the same one twice. */
const seen = new Set<string>();
/** Chats with work in flight, so a second text does not start a second call. */
const busy = new Set<string>();

function allowedSenders(): Set<string> | null {
	const raw = process.env.IMESSAGE_ALLOWED_SENDERS?.trim();
	if (!raw) return null;
	return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}
const senders = allowedSenders();

/** Null when STRIPE_SECRET_KEY is unset: calls are then free, as before. */
const paymentsConfig = loadPaymentsConfig(process.env, fileURLToPath(new URL('../../../.local/imessage-ledger.jsonl', import.meta.url)));
const payments = paymentsConfig
	? new Payments(paymentsConfig, {
			ledger: new Ledger(paymentsConfig.ledgerFile),
			stripe: new StripeClient({ secretKey: paymentsConfig.stripeSecretKey }),
			send: (chatGuid, text) => bb.send(chatGuid, text),
		})
	: null;

async function handle(msg: InboundMessage): Promise<void> {
	if (msg.isFromMe) return;
	if (seen.has(msg.guid)) return;
	seen.add(msg.guid);
	if (senders && !senders.has(msg.from)) {
		console.log(`[imessage] ignoring ${msg.from} — not in IMESSAGE_ALLOWED_SENDERS`);
		return;
	}
	if (payments && !msg.from) {
		console.log('[imessage] ignoring a message with no sender — nobody to bill');
		return;
	}
	if (busy.has(msg.chatGuid)) {
		await bb.send(msg.chatGuid, "Still working on the last one — I'll come back to you.");
		return;
	}

	busy.add(msg.chatGuid);
	try {
		const convo = conversations.get(msg.chatGuid) ?? { messages: [] };
		conversations.set(msg.chatGuid, convo);
		console.log(`[imessage] ${msg.from}: ${msg.text.slice(0, 80)}`);

		const reply = await respond(convo, msg.text, {
			provider,
			notify: (text) => bb.send(msg.chatGuid, text),
			// The sender address BlueBubbles reports is the only identity; never one taken from message text.
			...(payments ? { billing: payments.billingFor(msg.from, msg.chatGuid) } : {}),
		});
		if (reply) await bb.send(msg.chatGuid, reply);
	} catch (err) {
		console.error('[imessage] failed:', err);
		await bb
			.send(msg.chatGuid, "Something broke on my end — I didn't get that done. Try again?")
			.catch(() => {});
	} finally {
		busy.delete(msg.chatGuid);
	}
}

const server = createServer(async (req, res) => {
	const path = new URL(req.url ?? '/', 'http://localhost').pathname;
	if (req.method !== 'POST') {
		// Where Stripe sends the browser after Checkout. The balance is credited by the webhook, not by these pages.
		const page = path === PAID_PATH ? 'Payment received. Head back to Messages.' : path === CANCELLED_PATH ? 'No charge was made. Head back to Messages.' : 'ok';
		res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(page);
		return;
	}
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	if (path === STRIPE_WEBHOOK_PATH) {
		if (!payments) {
			res.writeHead(404).end();
			return;
		}
		try {
			// The signature covers the raw bytes, so verify before any parsing.
			const signature = req.headers['stripe-signature'];
			const status = await payments.handleWebhook(Buffer.concat(chunks).toString('utf8'), Array.isArray(signature) ? signature[0] : signature);
			res.writeHead(status).end();
		} catch (err) {
			// A 500 makes Stripe redeliver, which is right when the ledger write failed.
			console.error('[imessage] stripe webhook failed:', err);
			res.writeHead(500).end();
		}
		return;
	}
	if (path !== BB_WEBHOOK_PATH) {
		res.writeHead(404).end();
		return;
	}
	// Acknowledge immediately: BlueBubbles retries on a slow webhook, and a call
	// takes minutes.
	res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
	try {
		const msg = parseInbound(JSON.parse(Buffer.concat(chunks).toString('utf8')));
		if (msg) void handle(msg);
	} catch (err) {
		console.error('[imessage] bad webhook body:', err);
	}
});

async function main(): Promise<void> {
	if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
	if (payments && !BB_PASSWORD) throw new Error('BLUEBUBBLES_PASSWORD must be set when payments are on: it keeps the message webhook private');
	if (!(await bb.healthy())) {
		throw new Error(`BlueBubbles not reachable at ${BB_URL} — open BlueBubbles Server.app`);
	}
	// 0.0.0.0 so BlueBubbles reaches us whether it resolves localhost to v4 or v6.
	server.listen(PORT, '0.0.0.0', async () => {
		await bb.ensureWebhook(`http://127.0.0.1:${PORT}${BB_WEBHOOK_PATH}`);
		console.log(`[imessage] Dispatch listening on :${PORT}, provider=${provider.name}`);
		console.log(`[imessage] allowed senders: ${senders ? [...senders].join(', ') : 'anyone who texts'}`);
		console.log(
			paymentsConfig
				? `[imessage] payments on: calls billed at the agent's quote, ${dollars(paymentsConfig.topUpCents)} top-ups, Stripe webhook at ${paymentsConfig.publicUrl}${STRIPE_WEBHOOK_PATH}`
				: '[imessage] payments off (STRIPE_SECRET_KEY unset) — calls are free',
		);
		console.log(`[imessage] dialable numbers: ${process.env.DISPATCH_ALLOWED_NUMBERS || '(unrestricted — set DISPATCH_ALLOWED_NUMBERS)'}`);
	});
}

main().catch((err) => {
	console.error('[imessage] fatal:', err);
	process.exit(1);
});
