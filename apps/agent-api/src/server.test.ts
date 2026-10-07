import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AgentApi, INPUT_SCHEMA, createAgentApiServer, type ServerDeps } from './server.js';
import { sha256Hex, canonicalize, isValidPurchaserIdentifier, masumiInputHash } from './hash.js';
import { JobStore } from './store.js';

const escrow = {
	blockchainIdentifier: 'bc-1',
	payByTime: '1791331200000',
	submitResultTime: '1791334800000',
	unlockTime: '1791338400000',
	externalDisputeUnlockTime: '1791342000000',
};

const nonce = 'ab'.repeat(7);
const input = {
	to: '+15550100142',
	objective: 'Find out why claim 88-20417 was denied.',
	authorization: 'May verify identity. May NOT agree to payments.',
};

function api(overrides: Partial<ServerDeps> = {}): AgentApi {
	return new AgentApi({
		registrationConfirmed: async () => true,
		modelHealthy: async () => true,
		telephonyHealthy: async () => true,
		createEscrow: async () => escrow,
		agentIdentifier: () => 'a'.repeat(64),
		sellerVKey: () => 'vkey',
		paymentSource: () => ({ paymentSourceType: 'Web3CardanoV2', supportedPaymentSourceIndex: 0 }),
		store: new JobStore(mkdtempSync(join(tmpdir(), 'api-'))),
		policy: { allowedNumbers: null },
		...overrides,
	});
}

describe('input hashing', () => {
	it('is stable across property order', () => {
		expect(sha256Hex({ a: 1, b: 2 })).toBe(sha256Hex({ b: 2, a: 1 }));
	});
	it('distinguishes different inputs', () => {
		expect(sha256Hex({ to: '+1' })).not.toBe(sha256Hex({ to: '+2' }));
	});
	it('is a 64-char hex digest', () => {
		expect(sha256Hex({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
	});
	it('ignores undefined values rather than hashing them inconsistently', () => {
		expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
	});
});

describe('purchaser identifier', () => {
	it('accepts 14-26 hex characters', () => {
		expect(isValidPurchaserIdentifier('a'.repeat(14))).toBe(true);
		expect(isValidPurchaserIdentifier('f'.repeat(26))).toBe(true);
	});
	it('rejects anything outside that range or non-hex', () => {
		expect(isValidPurchaserIdentifier('a'.repeat(13))).toBe(false);
		expect(isValidPurchaserIdentifier('a'.repeat(27))).toBe(false);
		expect(isValidPurchaserIdentifier('zzzzzzzzzzzzzz')).toBe(false);
	});
});

describe('start_job', () => {
	it('returns escrow terms (Unix ms numbers), the payment source and the MIP-004 input hash', async () => {
		const res = await api().startJob({ identifier_from_purchaser: nonce, input_data: input });
		expect(res.code).toBe(200);
		const p = res.payload as Record<string, unknown>;
		expect(p.blockchainIdentifier).toBe('bc-1');
		expect(p.input_hash).toBe(masumiInputHash(input, nonce));
		expect(p.submitResultTime).toBe(Number(escrow.submitResultTime));
		expect(p).toMatchObject({ status: 'awaiting_payment', paymentSourceType: 'Web3CardanoV2', supportedPaymentSourceIndex: 0 });
	});

	it('returns the same terms for a retried request, without a second escrow', async () => {
		let escrows = 0;
		const a = api({ createEscrow: async () => { escrows += 1; return escrow; } });
		const first = await a.startJob({ identifier_from_purchaser: nonce, input_data: input });
		const again = await a.startJob({ identifier_from_purchaser: nonce, input_data: input });
		expect(again.payload).toEqual(first.payload);
		expect(escrows).toBe(1);
	});

	it('rejects a reused nonce with different input', async () => {
		const a = api();
		await a.startJob({ identifier_from_purchaser: nonce, input_data: input });
		const res = await a.startJob({ identifier_from_purchaser: nonce, input_data: { ...input, to: '+15550100187' } });
		expect(res.code).toBe(409);
	});

	it('rejects invalid input with field-level details, before any escrow', async () => {
		let escrowCalled = false;
		const res = await api({ createEscrow: async () => { escrowCalled = true; return escrow; } })
			.startJob({ identifier_from_purchaser: nonce, input_data: { to: 'call my mum' } });
		expect(res.code).toBe(400);
		expect((res.payload as { details: string[] }).details.join()).toMatch(/E\.164/);
		expect(escrowCalled).toBe(false);
	});

	it('refuses numbers outside the allowlist', async () => {
		const res = await api({ policy: { allowedNumbers: new Set(['+15550100187']) } })
			.startJob({ identifier_from_purchaser: nonce, input_data: input });
		expect(res.code).toBe(400);
	});

	it('rejects a malformed purchaser identifier', async () => {
		const res = await api().startJob({ identifier_from_purchaser: 'nope', input_data: {} });
		expect(res.code).toBe(400);
	});

	it('refuses work when telephony is down, before taking money', async () => {
		// Funds lock before work starts, so accepting a job we cannot perform
		// burns the buyer's escrow and our submitResultTime window.
		let escrowCalled = false;
		const res = await api({
			telephonyHealthy: async () => false,
			createEscrow: async () => { escrowCalled = true; return escrow; },
		}).startJob({ identifier_from_purchaser: nonce, input_data: input });
		expect(res.code).toBe(503);
		expect(escrowCalled).toBe(false);
		expect((res.payload as { reasons: string[] }).reasons.join()).toMatch(/telephony/);
	});

	it('refuses work when the agent is not registered on-chain', async () => {
		const res = await api({ registrationConfirmed: async () => false })
			.startJob({ identifier_from_purchaser: nonce, input_data: input });
		expect(res.code).toBe(503);
	});

	it('surfaces a payment-service failure rather than claiming a job started', async () => {
		const res = await api({ createEscrow: async () => { throw new Error('not seeded'); } })
			.startJob({ identifier_from_purchaser: nonce, input_data: input });
		expect(res.code).toBe(502);
	});
});

describe('status', () => {
	it('404s an unknown job rather than inventing one', () => {
		expect(api().status('missing').code).toBe(404);
	});
	it('reports awaiting_payment immediately after start', async () => {
		const a = api();
		const started = await a.startJob({ identifier_from_purchaser: nonce, input_data: input });
		const id = (started.payload as { id: string }).id;
		expect((a.status(id).payload as { status: string }).status).toBe('awaiting_payment');
	});
	it('withholds the result until the job is completed', async () => {
		const store = new JobStore(mkdtempSync(join(tmpdir(), 'api-')));
		const a = api({ store });
		const id = ((await a.startJob({ identifier_from_purchaser: nonce, input_data: input })).payload as { id: string }).id;
		store.put({ ...store.get(id)!, phase: 'awaiting_confirmation', result: '{"summary":"x"}', outputHash: 'e'.repeat(64) });
		expect(a.status(id).payload).not.toHaveProperty('result');
		store.put({ ...store.get(id)!, phase: 'completed' });
		expect(a.status(id).payload).toMatchObject({ status: 'completed', result: '{"summary":"x"}', output_hash: 'e'.repeat(64) });
	});
});

describe('input_schema', () => {
	it('returns input_data and never input_groups', () => {
		expect(INPUT_SCHEMA).toHaveProperty('input_data');
		expect(INPUT_SCHEMA).not.toHaveProperty('input_groups');
	});
	it('documents that authorization is hashed on-chain', () => {
		const field = INPUT_SCHEMA.input_data.find((f) => f.id === 'authorization');
		expect(field?.data.description).toMatch(/hashed on-chain/);
	});
});

describe('HTTP server', () => {
	async function serve(token?: string) {
		const server = createAgentApiServer(api(), token).listen(0);
		await new Promise((r) => server.once('listening', r));
		const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		return { base, close: () => server.close() };
	}

	it('keeps buyer routes public even when an operator token is configured', async () => {
		const { base, close } = await serve('secret');
		try {
			expect((await fetch(`${base}/input_schema`)).status).toBe(200);
			const start = await fetch(`${base}/start_job`, {
				method: 'POST',
				body: JSON.stringify({ identifier_from_purchaser: nonce, input_data: input }),
			});
			expect(start.status).toBe(200);
		} finally {
			close();
		}
	});

	it('protects the operator /jobs route with the token', async () => {
		const { base, close } = await serve('secret');
		try {
			expect((await fetch(`${base}/jobs`)).status).toBe(401);
			expect((await fetch(`${base}/jobs`, { headers: { authorization: 'Bearer secret' } })).status).toBe(200);
		} finally {
			close();
		}
	});

	it('answers malformed JSON with 400, not 500', async () => {
		const { base, close } = await serve();
		try {
			expect((await fetch(`${base}/start_job`, { method: 'POST', body: '{nope' })).status).toBe(400);
		} finally {
			close();
		}
	});
});
