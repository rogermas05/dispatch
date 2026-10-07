import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JobStore } from './store.js';
import type { Job } from './types.js';

const job = (over: Partial<Job> = {}): Job => ({
	id: '11111111-2222-3333-4444-555555555555',
	phase: 'awaiting_payment',
	createdAt: '2026-10-07T00:00:00Z',
	updatedAt: '2026-10-07T00:00:00Z',
	identifierFromPurchaser: 'ab'.repeat(7),
	inputData: { to: '+15550100142' },
	inputHash: 'f'.repeat(64),
	blockchainIdentifier: 'bc-1',
	payByTime: '1',
	submitResultTime: '2',
	unlockTime: '3',
	externalDisputeUnlockTime: '4',
	...over,
});

describe('JobStore', () => {
	const dir = () => mkdtempSync(join(tmpdir(), 'jobs-'));

	it('round-trips a job and survives a new store instance (restart)', () => {
		const d = dir();
		new JobStore(d).put(job());
		expect(new JobStore(d).get(job().id)).toMatchObject({ phase: 'awaiting_payment', blockchainIdentifier: 'bc-1' });
	});

	it('leaves no temp files behind', () => {
		const d = dir();
		new JobStore(d).put(job());
		expect(readdirSync(d)).toEqual([`${job().id}.json`]);
	});

	it('finds a job by purchaser identifier for idempotent start_job', () => {
		const store = new JobStore(dir());
		store.put(job());
		expect(store.findByPurchaserIdentifier('ab'.repeat(7))?.id).toBe(job().id);
		expect(store.findByPurchaserIdentifier('cd'.repeat(7))).toBeUndefined();
	});

	it('refuses path-like ids instead of reading outside the directory', () => {
		const store = new JobStore(dir());
		expect(store.get('../../etc/passwd')).toBeUndefined();
		expect(() => store.put(job({ id: '../x' }))).toThrow(/invalid job id/);
	});
});
