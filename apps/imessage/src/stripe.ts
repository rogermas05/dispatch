import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The two Stripe calls a prepaid balance needs: mint a hosted Checkout link, and
 * recognise the webhook that says it was paid.
 *
 * Hosted Checkout specifically — Apple Pay works there with no domain
 * registration, which an embedded form on our own domain would need.
 */

const API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 30_000;
/** Stripe's shortest allowed session lifetime. A link in a text thread should not stay payable for a day. */
const SESSION_TTL_SECONDS = 30 * 60;
/** How old a webhook signature may be before it is treated as a replay. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface CheckoutRequest {
	handle: string;
	/** Where to text the confirmation once the payment lands. */
	chatGuid: string;
	amountCents: number;
	successUrl: string;
	cancelUrl: string;
}

export class StripeClient {
	constructor(
		private readonly cfg: { secretKey: string; fetchImpl?: typeof fetch; now?: () => number },
	) {}

	/** A fresh single-use payment link. Never reuse one across people: the session is how a payment finds its balance. */
	async createCheckoutUrl(req: CheckoutRequest): Promise<string> {
		const now = this.cfg.now ?? Date.now;
		const form = new URLSearchParams({
			mode: 'payment',
			'line_items[0][quantity]': '1',
			'line_items[0][price_data][currency]': 'usd',
			'line_items[0][price_data][unit_amount]': String(req.amountCents),
			'line_items[0][price_data][product_data][name]': 'Dispatch balance',
			client_reference_id: req.handle,
			'metadata[handle]': req.handle,
			'metadata[chatGuid]': req.chatGuid,
			success_url: req.successUrl,
			cancel_url: req.cancelUrl,
			expires_at: String(Math.floor(now() / 1000) + SESSION_TTL_SECONDS),
		});
		const res = await (this.cfg.fetchImpl ?? fetch)(`${API}/checkout/sessions`, {
			method: 'POST',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { authorization: `Bearer ${this.cfg.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
			body: form.toString(),
		});
		const json = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
		if (!res.ok || !json?.url) {
			throw new Error(`stripe checkout -> ${res.status}: ${json?.error?.message ?? 'no session url returned'}`);
		}
		return json.url;
	}
}

/**
 * Check a Stripe-Signature header against the raw request body. The body must
 * be the bytes Stripe sent: re-serialised JSON will not match.
 */
export function verifySignature(rawBody: string, header: string | undefined, secret: string, nowMs: number = Date.now()): boolean {
	if (!header) return false;
	const parts = header.split(',').map((p) => p.trim().split('='));
	const timestamp = parts.find(([k]) => k === 't')?.[1];
	const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
	if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
	if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
	return signatures.some((sig) => {
		const given = Buffer.from(sig, 'hex');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}

export interface PaidTopUp {
	sessionId: string;
	handle: string;
	chatGuid: string;
	amountCents: number;
}

/** The top-up a verified event describes, or null for any event that is not a paid Checkout session of ours. */
export function parsePaidTopUp(event: unknown): PaidTopUp | null {
	const e = event as { type?: string; data?: { object?: Record<string, unknown> } };
	if (e?.type !== 'checkout.session.completed') return null;
	const session = e.data?.object;
	if (!session || session.payment_status !== 'paid') return null;
	const metadata = (session.metadata ?? {}) as Record<string, unknown>;
	const { id, client_reference_id: handle, amount_total: amount } = session;
	if (typeof id !== 'string' || typeof handle !== 'string' || !handle) return null;
	// Credit what Stripe says was paid, not what we meant to charge.
	if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return null;
	return { sessionId: id, handle, chatGuid: typeof metadata.chatGuid === 'string' ? metadata.chatGuid : '', amountCents: amount };
}
