import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parsePaidTopUp, StripeClient, verifySignature } from './stripe.js';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000_000;

function sign(body: string, secret = SECRET, atMs = NOW): string {
	const t = Math.floor(atMs / 1000);
	return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

describe('verifySignature', () => {
	const body = '{"id":"evt_1"}';

	it('accepts a body signed with our secret', () => {
		expect(verifySignature(body, sign(body), SECRET, NOW)).toBe(true);
	});

	it('rejects a body that was altered after signing', () => {
		expect(verifySignature('{"id":"evt_2"}', sign(body), SECRET, NOW)).toBe(false);
	});

	it('rejects a signature made with another secret', () => {
		expect(verifySignature(body, sign(body, 'whsec_other'), SECRET, NOW)).toBe(false);
	});

	it('rejects a signature older than the replay window', () => {
		expect(verifySignature(body, sign(body, SECRET, NOW - 6 * 60_000), SECRET, NOW)).toBe(false);
	});

	it('rejects a missing or malformed header', () => {
		expect(verifySignature(body, undefined, SECRET, NOW)).toBe(false);
		expect(verifySignature(body, 'nonsense', SECRET, NOW)).toBe(false);
		expect(verifySignature(body, `t=${Math.floor(NOW / 1000)},v1=zz`, SECRET, NOW)).toBe(false);
	});

	it('accepts when any one of several v1 signatures matches', () => {
		const good = sign(body);
		const header = good.replace(',v1=', `,v1=${'0'.repeat(64)},v1=`);

		expect(verifySignature(body, header, SECRET, NOW)).toBe(true);
	});
});

describe('parsePaidTopUp', () => {
	const event = (over: Record<string, unknown> = {}, type = 'checkout.session.completed') => ({
		type,
		data: { object: { id: 'cs_1', payment_status: 'paid', client_reference_id: '+14155550123', amount_total: 500, metadata: { chatGuid: 'chat-1' }, ...over } },
	});

	it('reads the session, payer, chat and the amount Stripe collected', () => {
		expect(parsePaidTopUp(event())).toEqual({ sessionId: 'cs_1', handle: '+14155550123', chatGuid: 'chat-1', amountCents: 500 });
	});

	it('ignores other event types', () => {
		expect(parsePaidTopUp(event({}, 'payment_intent.succeeded'))).toBeNull();
	});

	it('ignores a completed session that is not yet paid', () => {
		expect(parsePaidTopUp(event({ payment_status: 'unpaid' }))).toBeNull();
	});

	it('ignores a session with nobody to credit or nothing paid', () => {
		expect(parsePaidTopUp(event({ client_reference_id: null }))).toBeNull();
		expect(parsePaidTopUp(event({ amount_total: 0 }))).toBeNull();
		expect(parsePaidTopUp(null)).toBeNull();
	});
});

describe('StripeClient.createCheckoutUrl', () => {
	const request = { handle: '+14155550123', chatGuid: 'chat-1', amountCents: 500, successUrl: 'https://x.test/paid', cancelUrl: 'https://x.test/cancelled' };

	it('asks Stripe for a one-off hosted session tied to the payer', async () => {
		const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1' })));
		const stripe = new StripeClient({ secretKey: 'sk_test_1', fetchImpl: fetchImpl as typeof fetch, now: () => NOW });

		const url = await stripe.createCheckoutUrl(request);

		expect(url).toBe('https://checkout.stripe.com/c/pay/cs_1');
		const [calledUrl, init] = fetchImpl.mock.calls[0]!;
		expect(calledUrl).toBe('https://api.stripe.com/v1/checkout/sessions');
		expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk_test_1');
		const form = new URLSearchParams(init!.body as string);
		expect(form.get('mode')).toBe('payment');
		expect(form.get('client_reference_id')).toBe('+14155550123');
		expect(form.get('metadata[chatGuid]')).toBe('chat-1');
		expect(form.get('line_items[0][price_data][unit_amount]')).toBe('500');
		expect(form.get('expires_at')).toBe(String(NOW / 1000 + 30 * 60));
	});

	it('throws with Stripe\'s message when the session is refused', async () => {
		const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), { status: 401 })) as typeof fetch;
		const stripe = new StripeClient({ secretKey: 'sk_bad', fetchImpl });

		await expect(stripe.createCheckoutUrl(request)).rejects.toThrow(/401.*Invalid API Key/);
	});
});
