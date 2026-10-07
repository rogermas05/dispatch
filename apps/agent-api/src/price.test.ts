import { describe, it, expect } from 'vitest';
import { priceForJob } from './payment.js';

/**
 * Priced on the duration ceiling, not actual time: escrow locks a fixed amount
 * before the call runs, so there is nothing to bill against afterwards. The
 * buyer agrees to a number for a call of at most that length.
 */
const price = { unit: 'usdm', amount: '50000', perMinute: '50000' }; // 0.05 + 0.05/min

describe('priceForJob', () => {
	it('charges base plus one unit per expected minute', () => {
		// 3 minutes: 0.05 + 3 x 0.05 = 0.20
		expect(priceForJob(price, { calls: 1, maxDurationSeconds: 180, researchBudget: 0n }).amount).toBe('200000');
	});

	it('costs more for a longer call', () => {
		const short = BigInt(priceForJob(price, { calls: 1, maxDurationSeconds: 180, researchBudget: 0n }).amount);
		const long = BigInt(priceForJob(price, { calls: 1, maxDurationSeconds: 1800, researchBudget: 0n }).amount);
		expect(long).toBeGreaterThan(short);
	});

	it('scales with the number of calls', () => {
		const one = BigInt(priceForJob(price, { calls: 1, maxDurationSeconds: 180, researchBudget: 0n }).amount);
		const three = BigInt(priceForJob(price, { calls: 3, maxDurationSeconds: 180, researchBudget: 0n }).amount);
		expect(three - BigInt(price.amount)).toBe(3n * (one - BigInt(price.amount)));
	});

	it('rounds part-minutes up — a 90 second call is billed as two', () => {
		expect(priceForJob(price, { calls: 1, maxDurationSeconds: 90, researchBudget: 0n }).amount).toBe('150000');
	});

	it('passes the research budget straight through', () => {
		const withResearch = priceForJob(price, { calls: 1, maxDurationSeconds: 180, researchBudget: 1_000_000n });
		expect(withResearch.amount).toBe('1200000');
	});

	it('never charges less than the base fee', () => {
		const tiny = priceForJob(price, { calls: 0, maxDurationSeconds: 1, researchBudget: 0n });
		expect(BigInt(tiny.amount)).toBeGreaterThanOrEqual(BigInt(price.amount));
	});

	it('falls back to a flat fee when no per-minute rate is set', () => {
		const flat = { unit: 'usdm', amount: '50000' };
		expect(priceForJob(flat, { calls: 1, maxDurationSeconds: 1800, researchBudget: 0n }).amount).toBe('50000');
	});
});
