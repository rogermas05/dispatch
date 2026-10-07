import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Ledger } from './ledger.js';
import { centsForQuote, loadPaymentsConfig, Payments } from './payments.js';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000_000;
const HANDLE = '+14155550123';
const CHAT = 'iMessage;-;+14155550123';

function setup() {
	const ledger = new Ledger();
	const send = vi.fn(async (_chatGuid: string, _text: string) => {});
	const createCheckoutUrl = vi.fn(async (_req: { amountCents: number; handle: string; chatGuid: string; successUrl: string; cancelUrl: string }) => 'https://checkout.stripe.com/c/pay/cs_1');
	const payments = new Payments(
		{ stripeWebhookSecret: SECRET, publicUrl: 'https://pay.test', topUpCents: 500 },
		{ ledger, stripe: { createCheckoutUrl }, send, now: () => NOW },
	);
	return { ledger, send, createCheckoutUrl, payments };
}

function paidEvent(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: 'checkout.session.completed',
		data: { object: { id: 'cs_1', payment_status: 'paid', client_reference_id: HANDLE, amount_total: 500, metadata: { chatGuid: CHAT }, ...over } },
	});
}

function sign(body: string, secret = SECRET): string {
	const t = Math.floor(NOW / 1000);
	return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

describe('Payments.handleWebhook', () => {
	it('credits a paid session and texts the payer their balance', async () => {
		const { ledger, send, payments } = setup();
		const body = paidEvent();

		const status = await payments.handleWebhook(body, sign(body));

		expect(status).toBe(200);
		expect(ledger.balance(HANDLE)).toBe(500);
		expect(send).toHaveBeenCalledWith(CHAT, expect.stringContaining('$5.00'));
	});

	it('credits and texts only once when Stripe redelivers the event', async () => {
		const { ledger, send, payments } = setup();
		const body = paidEvent();

		await payments.handleWebhook(body, sign(body));
		const status = await payments.handleWebhook(body, sign(body));

		expect(status).toBe(200);
		expect(ledger.balance(HANDLE)).toBe(500);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('answers 400 and credits nothing for a forged event', async () => {
		const { ledger, send, payments } = setup();
		const body = paidEvent();

		const status = await payments.handleWebhook(body, sign(body, 'whsec_attacker'));

		expect(status).toBe(400);
		expect(ledger.balance(HANDLE)).toBe(0);
		expect(send).not.toHaveBeenCalled();
	});

	it('acknowledges events it does not act on', async () => {
		const { ledger, payments } = setup();
		const body = JSON.stringify({ type: 'payment_intent.created', data: { object: {} } });

		expect(await payments.handleWebhook(body, sign(body))).toBe(200);
		expect(ledger.balance(HANDLE)).toBe(0);
	});

	it('keeps the credit when the confirmation text fails to send', async () => {
		const { ledger, send, payments } = setup();
		send.mockRejectedValueOnce(new Error('bluebubbles down'));
		const body = paidEvent();

		const status = await payments.handleWebhook(body, sign(body));

		expect(status).toBe(200);
		expect(ledger.balance(HANDLE)).toBe(500);
	});
});

describe('Payments.billingFor', () => {
	it('charges the quoted price and refuses when the balance is short', () => {
		const { ledger, payments } = setup();
		ledger.topUp(HANDLE, 70, 'cs_0');
		const billing = payments.billingFor(HANDLE, CHAT);

		expect(billing.charge('job-1', 50)).toBe(true);
		expect(billing.charge('job-2', 50)).toBe(false);
		expect(billing.balanceCents()).toBe(20);
	});

	it('returns the charge for a call that never completed', () => {
		const { ledger, payments } = setup();
		ledger.topUp(HANDLE, 50, 'cs_0');
		const billing = payments.billingFor(HANDLE, CHAT);
		billing.charge('job-1', 50);

		billing.refund('job-1');

		expect(billing.balanceCents()).toBe(50);
	});

	it('texts a fresh checkout link for this sender as its own message', async () => {
		const { send, createCheckoutUrl, payments } = setup();

		await payments.billingFor(HANDLE, CHAT).sendTopUpLink();

		expect(createCheckoutUrl).toHaveBeenCalledWith({ handle: HANDLE, chatGuid: CHAT, amountCents: 500, successUrl: 'https://pay.test/paid', cancelUrl: 'https://pay.test/cancelled' });
		expect(send).toHaveBeenCalledWith(CHAT, 'https://checkout.stripe.com/c/pay/cs_1');
	});
});

describe('loadPaymentsConfig', () => {
	const env = { STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: SECRET, PAYMENTS_PUBLIC_URL: 'https://pay.test/' };

	it('is off when there is no Stripe key', () => {
		expect(loadPaymentsConfig({}, '/tmp/ledger.jsonl')).toBeNull();
	});

	it('defaults to $5 top-ups', () => {
		expect(loadPaymentsConfig(env, '/tmp/ledger.jsonl')).toMatchObject({ topUpCents: 500, publicUrl: 'https://pay.test', ledgerFile: '/tmp/ledger.jsonl' });
	});

	it('refuses to start half-configured', () => {
		expect(() => loadPaymentsConfig({ ...env, STRIPE_WEBHOOK_SECRET: '' }, '/tmp/l')).toThrow(/STRIPE_WEBHOOK_SECRET/);
		expect(() => loadPaymentsConfig({ ...env, PAYMENTS_PUBLIC_URL: 'http://pay.test' }, '/tmp/l')).toThrow(/https/);
	});

	it('rejects top-ups that are not whole cents or are below Stripe\'s minimum', () => {
		expect(() => loadPaymentsConfig({ ...env, IMESSAGE_TOPUP_CENTS: '500.5' }, '/tmp/l')).toThrow(/IMESSAGE_TOPUP_CENTS/);
		expect(() => loadPaymentsConfig({ ...env, IMESSAGE_TOPUP_CENTS: '25' }, '/tmp/l')).toThrow(/at least 50/);
	});
});

describe('centsForQuote', () => {
	it('bills one dollar per tUSDM, rounding part-cents up', () => {
		expect(centsForQuote('1')).toBe(100);
		expect(centsForQuote('0.05')).toBe(5);
		expect(centsForQuote('0.125')).toBe(13);
	});

	it('refuses a quote it cannot bill, so no call goes unpaid', () => {
		expect(() => centsForQuote(null)).toThrow(/price/);
		expect(() => centsForQuote('0')).toThrow(/price/);
		expect(() => centsForQuote('abc')).toThrow(/price/);
	});
});
