import { createServer } from 'node:http';
import { BlueBubbles, parseInbound, type InboundMessage } from './bluebubbles.js';
import { respond, type Conversation } from './agent.js';
import { selectProvider } from '../../worker/src/call/select.ts';

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

async function handle(msg: InboundMessage): Promise<void> {
	if (msg.isFromMe) return;
	if (seen.has(msg.guid)) return;
	seen.add(msg.guid);
	if (senders && !senders.has(msg.from)) {
		console.log(`[imessage] ignoring ${msg.from} — not in IMESSAGE_ALLOWED_SENDERS`);
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
	if (req.method !== 'POST') {
		res.writeHead(200).end('ok');
		return;
	}
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
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
	if (!(await bb.healthy())) {
		throw new Error(`BlueBubbles not reachable at ${BB_URL} — open BlueBubbles Server.app`);
	}
	// 0.0.0.0 so BlueBubbles reaches us whether it resolves localhost to v4 or v6.
	server.listen(PORT, '0.0.0.0', async () => {
		await bb.ensureWebhook(`http://127.0.0.1:${PORT}/webhook`);
		console.log(`[imessage] Dispatch listening on :${PORT}, provider=${provider.name}`);
		console.log(`[imessage] allowed senders: ${senders ? [...senders].join(', ') : 'anyone who texts'}`);
		console.log(`[imessage] dialable numbers: ${process.env.DISPATCH_ALLOWED_NUMBERS || '(unrestricted — set DISPATCH_ALLOWED_NUMBERS)'}`);
	});
}

main().catch((err) => {
	console.error('[imessage] fatal:', err);
	process.exit(1);
});
