/**
 * BlueBubbles bridge — a self-hosted iMessage gateway running on this Mac.
 *
 * It reads chat.db and drives Messages.app, exposing a REST API for sending and
 * a webhook for inbound messages. The Mac has to stay awake and signed into
 * iMessage; most "the bot stopped working" reports are the machine sleeping.
 */

import { randomUUID } from 'node:crypto';

export interface InboundMessage {
	chatGuid: string;
	text: string;
	/** Sender handle, e.g. +15551234567. */
	from: string;
	isFromMe: boolean;
	guid: string;
}

export class BlueBubbles {
	constructor(
		private readonly baseUrl: string,
		private readonly password: string,
	) {}

	private url(path: string): string {
		return `${this.baseUrl.replace(/\/$/, '')}/api/v1${path}?password=${encodeURIComponent(this.password)}`;
	}

	async healthy(): Promise<boolean> {
		try {
			const res = await fetch(this.url('/server/info'));
			return res.ok;
		} catch {
			return false;
		}
	}

	async send(chatGuid: string, message: string): Promise<void> {
		const res = await fetch(this.url('/message/text'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// apple-script works without the Private API helper. It cannot start a
			// thread with a brand-new number, which is fine: the person texts first.
			// It also requires a tempGuid — the client-side id BlueBubbles uses to
			// match the message it sends against the one that appears in chat.db.
			body: JSON.stringify({ chatGuid, message, method: 'apple-script', tempGuid: randomUUID() }),
		});
		if (!res.ok) throw new Error(`bluebubbles send -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
	}

	/** Register our webhook, unless an identical one is already there. */
	async ensureWebhook(webhookUrl: string): Promise<void> {
		const existing = (await (await fetch(this.url('/webhook'))).json()) as { data?: Array<{ url: string }> };
		if (existing.data?.some((h) => h.url === webhookUrl)) return;
		const res = await fetch(this.url('/webhook'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ url: webhookUrl, events: ['new-message'] }),
		});
		if (!res.ok) throw new Error(`webhook registration -> ${res.status}`);
	}
}

/** Pull the parts we care about out of a BlueBubbles webhook body. */
export function parseInbound(body: unknown): InboundMessage | null {
	const payload = body as { type?: string; data?: Record<string, unknown> };
	if (payload.type !== 'new-message' || !payload.data) return null;
	const d = payload.data;
	const chats = d.chats as Array<{ guid?: string }> | undefined;
	const chatGuid = chats?.[0]?.guid;
	const text = typeof d.text === 'string' ? d.text.trim() : '';
	if (!chatGuid || !text) return null;
	return {
		chatGuid,
		text,
		from: ((d.handle as { address?: string } | undefined)?.address ?? '').trim(),
		isFromMe: d.isFromMe === true,
		guid: String(d.guid ?? ''),
	};
}
