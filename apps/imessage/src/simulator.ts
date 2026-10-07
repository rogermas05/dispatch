import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createInterface } from 'node:readline';
import { webhookPath } from './bluebubbles.js';

/**
 * A stand-in for BlueBubbles Server, so the bot can be tried from a terminal on
 * a Mac without it. It answers the three endpoints the bot uses, prints what the
 * bot texts, and delivers each typed line as an inbound iMessage from `handle`.
 *
 * Everything past the message bridge is real: Claude, Stripe, Masumi, the call.
 */

export interface Simulator {
	/** Base URL to give the bot as BLUEBUBBLES_URL. */
	url: string;
	/** Read lines from stdin and deliver them to the bot, until stdin closes. */
	chat(botPort: number): void;
	close(): void;
}

const say = (text: string) => process.stdout.write(`\n\x1b[36mDispatch:\x1b[0m ${text}\n\x1b[2myou:\x1b[0m `);

export async function startSimulator(password: string, handle: string): Promise<Simulator> {
	const chatGuid = `iMessage;-;${handle}`;
	const hooks: unknown[] = [];

	const server: Server = createServer(async (req, res) => {
		const path = new URL(req.url ?? '/', 'http://localhost').pathname;
		let body = '';
		for await (const chunk of req) body += chunk;
		const ok = (data: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 200, data }));

		if (path === '/api/v1/server/info') return ok({});
		if (path === '/api/v1/webhook') {
			if (req.method === 'POST') hooks.push(JSON.parse(body));
			return ok(hooks);
		}
		if (path === '/api/v1/message/text' && req.method === 'POST') {
			say((JSON.parse(body) as { message: string }).message);
			return ok({});
		}
		res.writeHead(404).end();
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;

	return {
		url: `http://127.0.0.1:${port}`,
		chat(botPort) {
			const inbox = `http://127.0.0.1:${botPort}${webhookPath(password)}`;
			process.stdout.write(`\nTexting as ${handle}. Type a message and press enter; Ctrl-C to quit.\n\x1b[2myou:\x1b[0m `);
			createInterface({ input: process.stdin }).on('line', async (line) => {
				const text = line.trim();
				if (!text) return;
				const message = { type: 'new-message', data: { guid: randomUUID(), text, isFromMe: false, handle: { address: handle }, chats: [{ guid: chatGuid }] } };
				const res = await fetch(inbox, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) }).catch((err: unknown) => err);
				if (!(res instanceof Response) || !res.ok) say(`(could not reach the bot: ${res instanceof Response ? res.status : String(res)})`);
			});
		},
		close: () => server.close(),
	};
}
