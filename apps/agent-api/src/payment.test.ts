import { describe, it, expect } from 'vitest';
import { PaymentServiceClient, PaymentError, isConfirmed, type PaymentConfig } from './payment.js';

interface Call { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function client(respond: (path: string, body: Record<string, unknown>) => { status?: number; json: unknown }, overrides: Partial<PaymentConfig> = {}) {
	const calls: Call[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		calls.push({ url, body, headers: init.headers as Record<string, string> });
		const path = url.replace('http://mps/api/v1', '');
		const { status = 200, json } = respond(path, body);
		return new Response(JSON.stringify(json), { status });
	}) as unknown as typeof fetch;
	const mps = new PaymentServiceClient({
		baseUrl: 'http://mps/api/v1/',
		token: 'pay-key',
		network: 'Preprod',
		agentIdentifier: 'a'.repeat(64),
		paymentSourceType: 'Web3CardanoV2',
		supportedPaymentSourceIndex: 0,
		price: { unit: 'usdm-unit', amount: '1000000' },
		windows: { payBy: 10, submitResult: 60, unlock: 120, externalDispute: 180 },
		fetchImpl,
		now: () => Date.parse('2026-10-07T00:00:00Z'),
		...overrides,
	});
	return { mps, calls };
}

const terms = { blockchainIdentifier: 'bc-1', payByTime: '1', submitResultTime: '2', unlockTime: '3', externalDisputeUnlockTime: '4' };

describe('createPayment', () => {
	it('sends V2 terms, price and windows with the token header', async () => {
		const { mps, calls } = client(() => ({ json: { status: 'success', data: terms } }));
		const result = await mps.createPayment({ inputHash: 'f'.repeat(64), identifierFromPurchaser: 'ab'.repeat(7) });
		expect(result).toEqual(terms);
		const [call] = calls;
		expect(call!.url).toBe('http://mps/api/v1/payment');
		expect(call!.headers.token).toBe('pay-key');
		expect(call!.body).toMatchObject({
			network: 'Preprod',
			paymentSourceType: 'Web3CardanoV2',
			supportedPaymentSourceIndex: 0,
			RequestedFunds: [{ unit: 'usdm-unit', amount: '1000000' }],
			payByTime: '2026-10-07T00:10:00.000Z',
			submitResultTime: '2026-10-07T01:00:00.000Z',
		});
	});

	it('omits RequestedFunds for fixed pricing', async () => {
		const { mps, calls } = client(() => ({ json: { status: 'success', data: terms } }), { price: null });
		await mps.createPayment({ inputHash: 'f'.repeat(64), identifierFromPurchaser: 'ab'.repeat(7) });
		expect(calls[0]!.body).not.toHaveProperty('RequestedFunds');
	});

	it('surfaces MPS errors with the HTTP status', async () => {
		const { mps } = client(() => ({ status: 400, json: { status: 'error', error: { message: 'bad agent' } } }));
		await expect(mps.createPayment({ inputHash: 'f'.repeat(64), identifierFromPurchaser: 'ab'.repeat(7) })).rejects.toThrow(PaymentError);
	});

	it('rejects a response that lacks escrow terms', async () => {
		const { mps } = client(() => ({ json: { status: 'success', data: { blockchainIdentifier: 'bc-1' } } }));
		await expect(mps.createPayment({ inputHash: 'f'.repeat(64), identifierFromPurchaser: 'ab'.repeat(7) })).rejects.toThrow(/missing payByTime/);
	});

	it('requires a source index for V2', () => {
		expect(() => client(() => ({ json: {} }), { supportedPaymentSourceIndex: undefined })).toThrow(/supportedPaymentSourceIndex/);
	});
});

describe('resolve', () => {
	it('reports FundsLocked as confirmed only with a Confirmed transaction into it', async () => {
		const { mps } = client(() => ({
			json: { status: 'success', data: { onChainState: 'FundsLocked', TransactionHistory: [{ status: 'Confirmed', newOnChainState: 'FundsLocked' }] } },
		}));
		await expect(mps.resolve('bc-1')).resolves.toMatchObject({ onChainState: 'FundsLocked', confirmed: true });
	});

	it('treats a pending transaction as not yet confirmed', async () => {
		const { mps } = client(() => ({
			json: { status: 'success', data: { onChainState: 'FundsLocked', CurrentTransaction: { status: 'Pending', newOnChainState: 'FundsLocked' } } },
		}));
		await expect(mps.resolve('bc-1')).resolves.toMatchObject({ confirmed: false });
	});
});

describe('isConfirmed', () => {
	it('ignores confirmed transactions into a different state', () => {
		expect(isConfirmed({ CurrentTransaction: { status: 'Confirmed', newOnChainState: 'ResultSubmitted' } }, 'FundsLocked')).toBe(false);
	});
});

describe('submitResult', () => {
	it('posts the result hash for the escrow', async () => {
		const { mps, calls } = client(() => ({ json: { status: 'success', data: {} } }));
		await mps.submitResult('bc-1', 'e'.repeat(64));
		expect(calls[0]!.url).toBe('http://mps/api/v1/payment/submit-result');
		expect(calls[0]!.body).toEqual({ network: 'Preprod', blockchainIdentifier: 'bc-1', submitResultHash: 'e'.repeat(64) });
	});
});
