import { describe, it, expect, vi } from 'vitest';
import { masumiInputHash, masumiOutputHash } from '../hash.js';
import type { AgentListing, InputField, SellerTerms } from './clients.js';
import { fixedPrice } from './clients.js';
import { mapRequestToInput, runHire, type HireDeps, type HireState } from './hire.js';

const NOW = 1_800_000_000_000;
const AGENT = 'b'.repeat(64);
const listing: AgentListing = { agentIdentifier: AGENT, name: 'Research Bot', apiBaseUrl: 'https://research', price: { unit: 'usdm', amount: '500000' } };
const fields: InputField[] = [{ id: 'prompt', type: 'textarea', name: 'Prompt' }];

function setup(over: { listing?: AgentListing; fields?: InputField[]; terms?: (nonce: string, input: Record<string, unknown>) => Partial<SellerTerms>; result?: string; chainHash?: (nonce: string, result: string) => string | null } = {}) {
	const saved: HireState[] = [];
	const purchase = vi.fn(async () => {});
	const startJob = vi.fn(async (nonce: string, input: Record<string, unknown>): Promise<SellerTerms> => ({
		id: 'remote-job', blockchainIdentifier: 'bc-r', payByTime: NOW + 600_000, submitResultTime: NOW + 1_200_000,
		unlockTime: NOW + 2_000_000, externalDisputeUnlockTime: NOW + 3_000_000, agentIdentifier: AGENT, sellerVKey: 'vk',
		input_hash: masumiInputHash(input, nonce), ...over.terms?.(nonce, input),
	}));
	let nonceSeen = '';
	const result = over.result ?? 'Claims denied for CO-197 can be reconsidered within 180 days.';
	const deps: HireDeps = {
		lookup: async () => over.listing ?? listing,
		remote: () => ({
			inputFields: async () => over.fields ?? fields,
			startJob: async (nonce, input) => { nonceSeen = nonce; return startJob(nonce, input); },
			status: async () => ({ status: 'completed', result }),
		}),
		purchase,
		resolvePurchase: async () => ({ onChainState: 'ResultSubmitted', confirmed: true, resultHash: (over.chainHash ?? ((n, r) => masumiOutputHash(r, n)))(nonceSeen, result) }),
		save: (s) => saved.push(s),
		now: () => NOW,
		sleep: async () => {},
	};
	const req = { agentIdentifier: AGENT, request: 'How do CO-197 reconsiderations work?', budget: 1_000_000n, unit: 'usdm', deadline: NOW + 1 };
	return { deps, req, saved, purchase, startJob };
}

describe('mapRequestToInput', () => {
	it('fills the obvious prompt field', () => {
		expect(mapRequestToInput(fields, 'q')).toEqual({ prompt: 'q' });
	});
	it('uses the only text field even with an unusual name', () => {
		expect(mapRequestToInput([{ id: 'company', type: 'text' }], 'q')).toEqual({ company: 'q' });
	});
	it('refuses schemas with other required fields it cannot honestly fill', () => {
		expect(mapRequestToInput([...fields, { id: 'email', type: 'email' }], 'q')).toBeNull();
	});
	it('ignores optional extras and display-only fields', () => {
		expect(mapRequestToInput([...fields, { id: 'tone', type: 'text', validations: [{ validation: 'optional', value: 'true' }] }, { id: 'info', type: 'none' }], 'q')).toEqual({ prompt: 'q' });
	});
});

describe('fixedPrice', () => {
	it('accepts one fixed amount', () => {
		expect(fixedPrice({ pricingType: 'Fixed', Pricing: [{ amount: '5', unit: 'u' }] })).toEqual({ amount: '5', unit: 'u' });
	});
	it('treats dynamic pricing as unbounded', () => {
		expect(fixedPrice({ pricingType: 'Dynamic' })).toBeNull();
	});
});

describe('runHire', () => {
	it('quotes, verifies the input hash, pays the fixed price and returns a hash-verified result', async () => {
		const { deps, req, purchase, saved } = setup();
		const state = await runHire(req, undefined, deps);
		expect(state.stage).toBe('done');
		expect(state.result).toMatch(/180 days/);
		expect(purchase).toHaveBeenCalledWith(expect.objectContaining({ blockchainIdentifier: 'bc-r' }), state.nonce, { unit: 'usdm', amount: '500000' }, undefined);
		expect(saved.map((s) => s.stage)).toEqual(['quoting', 'terms_received', 'purchase_sent', 'done']);
	});

	it('refuses an agent over budget without starting a job', async () => {
		const { deps, req, startJob } = setup();
		const state = await runHire({ ...req, budget: 100_000n }, undefined, deps);
		expect(state).toMatchObject({ stage: 'failed', error: expect.stringMatching(/over the 100000 budget/) });
		expect(startJob).not.toHaveBeenCalled();
	});

	it('refuses dynamically priced agents, whose cost cannot be bounded', async () => {
		const { deps, req } = setup({ listing: { ...listing, price: null } });
		expect((await runHire(req, undefined, deps)).error).toMatch(/no fixed price/);
	});

	it('does not pay when the seller hashes our input differently', async () => {
		const { deps, req, purchase } = setup({ terms: () => ({ input_hash: 'f'.repeat(64) }) });
		expect((await runHire(req, undefined, deps)).error).toMatch(/input hash/);
		expect(purchase).not.toHaveBeenCalled();
	});

	it('rejects a result that does not match the on-chain hash', async () => {
		const { deps, req } = setup({ chainHash: () => 'e'.repeat(64) });
		expect((await runHire(req, undefined, deps)).error).toMatch(/does not match the hash committed on-chain/);
	});

	it('never re-sends a purchase after a restart in purchase_sent', async () => {
		const { deps, req, purchase } = setup();
		const resumed: HireState = { stage: 'purchase_sent', agentIdentifier: AGENT, nonce: 'aa'.repeat(7), terms: { id: 'remote-job', blockchainIdentifier: 'bc-r' } as SellerTerms };
		await runHire(req, resumed, deps);
		expect(purchase).not.toHaveBeenCalled();
	});

	it('gives up at the deadline instead of waiting forever', async () => {
		const { deps, req } = setup();
		const slow = { ...deps, remote: () => ({ ...deps.remote(''), status: async () => ({ status: 'running' }) }) };
		let t = NOW;
		const state = await runHire({ ...req, deadline: NOW + 30_000 }, undefined, { ...slow, now: () => (t += 10_000) });
		expect(state.error).toMatch(/deadline/);
	});
});
