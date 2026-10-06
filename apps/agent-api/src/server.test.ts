import { describe, it, expect } from 'vitest';
import { AgentApi, INPUT_SCHEMA, type ServerDeps } from './server.js';
import { sha256Hex, canonicalize, isValidPurchaserIdentifier } from './hash.js';

const escrow = {
	blockchainIdentifier: 'bc-1',
	payByTime: '2026-10-07T00:00:00Z',
	submitResultTime: '2026-10-07T01:00:00Z',
	unlockTime: '2026-10-07T02:00:00Z',
	externalDisputeUnlockTime: '2026-10-07T03:00:00Z',
};

function api(overrides: Partial<ServerDeps> = {}): AgentApi {
	return new AgentApi({
		registrationConfirmed: async () => true,
		modelHealthy: async () => true,
		telephonyHealthy: async () => true,
		createEscrow: async () => escrow,
		agentIdentifier: () => 'a'.repeat(64),
		sellerVKey: () => 'vkey',
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
	it('returns escrow terms and the input hash', async () => {
		const res = await api().startJob({ identifier_from_purchaser: 'ab'.repeat(7), input_data: { to: '+14155550123' } });
		expect(res.code).toBe(200);
		const p = res.payload as Record<string, unknown>;
		expect(p.blockchainIdentifier).toBe('bc-1');
		expect(p.input_hash).toBe(sha256Hex({ to: '+14155550123' }));
		expect(p.submitResultTime).toBe(escrow.submitResultTime);
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
		}).startJob({ identifier_from_purchaser: 'ab'.repeat(7), input_data: { to: '+1' } });
		expect(res.code).toBe(503);
		expect(escrowCalled).toBe(false);
		expect((res.payload as { reasons: string[] }).reasons.join()).toMatch(/telephony/);
	});

	it('refuses work when the agent is not registered on-chain', async () => {
		const res = await api({ registrationConfirmed: async () => false })
			.startJob({ identifier_from_purchaser: 'ab'.repeat(7), input_data: {} });
		expect(res.code).toBe(503);
	});

	it('surfaces a payment-service failure rather than claiming a job started', async () => {
		const res = await api({ createEscrow: async () => { throw new Error('not seeded'); } })
			.startJob({ identifier_from_purchaser: 'ab'.repeat(7), input_data: {} });
		expect(res.code).toBe(502);
	});
});

describe('status', () => {
	it('404s an unknown job rather than inventing one', () => {
		expect(api().status('missing').code).toBe(404);
	});
	it('reports awaiting_payment immediately after start', async () => {
		const a = api();
		const started = await a.startJob({ identifier_from_purchaser: 'ab'.repeat(7), input_data: {} });
		const id = (started.payload as { id: string }).id;
		expect((a.status(id).payload as { status: string }).status).toBe('awaiting_payment');
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
