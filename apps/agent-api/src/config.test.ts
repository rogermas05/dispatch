import { describe, it, expect } from 'vitest';
import { loadConfig, toAtomic } from './config.js';

const paid = {
	PAYMENT_SERVICE_URL: 'http://mps/api/v1',
	MPS_PAY_KEY: 'k',
	AGENT_IDENTIFIER: 'a'.repeat(64),
	USDM_UNIT: 'unit',
	TASK_PRICE_USDM: '0.5',
};

describe('toAtomic', () => {
	it('converts decimal tUSDM to 6-decimal atomic units', () => {
		expect(toAtomic('1')).toBe('1000000');
		expect(toAtomic('0.5')).toBe('500000');
		expect(toAtomic('2.000001')).toBe('2000001');
	});
	it('rejects zero, negatives, junk and excess precision', () => {
		for (const bad of ['0', '-1', 'one', '0.0000001']) expect(() => toAtomic(bad)).toThrow();
	});
});

describe('loadConfig', () => {
	it('leaves payment unconfigured (agent unavailable) until MPS details exist', () => {
		expect(loadConfig({}).payment).toBeNull();
	});
	it('builds a V2 dynamic-price payment config with default windows', () => {
		expect(loadConfig(paid).payment).toMatchObject({
			paymentSourceType: 'Web3CardanoV2',
			supportedPaymentSourceIndex: 0,
			price: { unit: 'unit', amount: '500000' },
			windows: { payBy: 15, submitResult: 60, unlock: 90, externalDispute: 150 },
		});
	});
	it('omits the price for fixed pricing', () => {
		expect(loadConfig({ ...paid, PRICING: 'fixed' }).payment?.price).toBeNull();
	});
	it('rejects windows that do not increase', () => {
		expect(() => loadConfig({ ...paid, ESCROW_UNLOCK_MINUTES: '30' })).toThrow(/must increase/);
	});
	it('with real telephony, an unset allowlist means dial nothing', () => {
		expect(loadConfig({ TELEPHONY_PROVIDER: 'telnyx' }).policy.allowedNumbers?.size).toBe(0);
	});
	it('with mock telephony, numbers are unrestricted because nothing is dialed', () => {
		expect(loadConfig({}).policy.allowedNumbers).toBeNull();
	});

	it('enables research only with agents, a separate buy key and dynamic pricing', () => {
		const agent = 'c'.repeat(64);
		const on = loadConfig({ ...paid, DISPATCH_RESEARCH_AGENTS: agent, MPS_BUY_KEY: 'buy' });
		expect(on.research).toEqual({ agents: [agent], buyKey: 'buy', timeoutMinutes: 10 });
		expect(on.policy.maxResearchBudget).toBe(2_000_000n);
		expect(loadConfig({ ...paid, DISPATCH_RESEARCH_AGENTS: agent }).research).toBeNull();
		expect(loadConfig({ ...paid, DISPATCH_RESEARCH_AGENTS: agent, MPS_BUY_KEY: 'buy', PRICING: 'fixed' }).research).toBeNull();
	});
	it('refuses to reuse the seller key for spending', () => {
		expect(() => loadConfig({ ...paid, DISPATCH_RESEARCH_AGENTS: 'c'.repeat(64), MPS_BUY_KEY: 'k' })).toThrow(/own spending-capped key/);
	});
	it('rejects malformed research agent identifiers', () => {
		expect(() => loadConfig({ ...paid, DISPATCH_RESEARCH_AGENTS: 'not-an-id', MPS_BUY_KEY: 'buy' })).toThrow(/malformed/);
	});
});
