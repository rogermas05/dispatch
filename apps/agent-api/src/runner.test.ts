import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { ExecuteInput, JobOutcome } from './execute.js';
import { canonicalize, masumiOutputHash } from './hash.js';
import { parseCallInput } from './input.js';
import type { PaymentState } from './payment.js';
import { JobRunner } from './runner.js';
import { JobStore } from './store.js';
import type { Job } from './types.js';

const NOW = Date.parse('2026-10-07T00:00:00Z');
const MIN = 60_000;
const nonce = 'ab'.repeat(7);

const outcome: JobOutcome = {
	status: 'completed',
	summary: 'Redelivery booked.',
	artifacts: { Ticket: 'BL-30982' },
	humanFollowUp: null,
	caveats: [],
	objectiveMet: true,
	calls: [],
	research: null,
	spend: { unit: 'usdm', budget: '0', spent: '0' },
};

function job(over: Partial<Job> = {}): Job {
	return {
		id: '11111111-2222-3333-4444-555555555555',
		phase: 'awaiting_payment',
		createdAt: new Date(NOW).toISOString(),
		updatedAt: new Date(NOW).toISOString(),
		identifierFromPurchaser: nonce,
		inputData: { to: '+15550100187', objective: 'Book a redelivery for SH-7731.', authorization: 'May book a free redelivery.', max_duration_seconds: 600 },
		inputHash: 'f'.repeat(64),
		blockchainIdentifier: 'bc-1',
		payByTime: String(NOW + 10 * MIN),
		submitResultTime: String(NOW + 60 * MIN),
		unlockTime: String(NOW + 120 * MIN),
		externalDisputeUnlockTime: String(NOW + 180 * MIN),
		...over,
	};
}

const state = (over: Partial<PaymentState> = {}): PaymentState => ({
	onChainState: null, resultHash: null, nextAction: null, errorNote: null, confirmed: false, ...over,
});

function setup(initial: Job, chain: PaymentState[], opts: { now?: number; execute?: (input: ExecuteInput) => Promise<JobOutcome> } = {}) {
	const store = new JobStore(mkdtempSync(join(tmpdir(), 'runner-')));
	store.put(initial);
	let i = 0;
	const payments = {
		resolve: vi.fn(async () => chain[Math.min(i++, chain.length - 1)]!),
		submitResult: vi.fn(async () => {}),
	};
	const execute = vi.fn(opts.execute ?? (async () => outcome));
	const runner = new JobRunner({
		store, payments, execute, parse: parseCallInput, policy: { allowedNumbers: null },
		now: () => opts.now ?? NOW, log: () => {},
	});
	const step = async () => { await runner.tick(); await runner.idle(); return store.get(initial.id)!; };
	return { store, payments, execute, runner, step };
}

describe('JobRunner', () => {
	it('does not dial while funds are not locked', async () => {
		const { step, execute } = setup(job(), [state()]);
		expect((await step()).phase).toBe('awaiting_payment');
		expect(execute).not.toHaveBeenCalled();
	});

	it('does not dial on a FundsLocked that is reported but not yet confirmed', async () => {
		const { step, execute } = setup(job(), [state({ onChainState: 'FundsLocked', confirmed: false })]);
		await step();
		expect(execute).not.toHaveBeenCalled();
	});

	it('dials on confirmed FundsLocked, submits the MIP-004 output hash, and completes once confirmed', async () => {
		const result = canonicalize(outcome);
		const hash = masumiOutputHash(result, nonce);
		const { step, execute, payments } = setup(job(), [
			state({ onChainState: 'FundsLocked', confirmed: true }),
			state({ onChainState: 'ResultSubmitted', confirmed: true, resultHash: hash }),
		]);
		const afterCall = await step();
		expect(execute).toHaveBeenCalledWith(expect.objectContaining({
			brief: expect.objectContaining({ to: '+15550100187', maxDurationSeconds: 600 }),
			plan: expect.objectContaining({ numbers: ['+15550100187'], strategy: 'single' }),
			jobId: job().id,
		}));
		expect(afterCall).toMatchObject({ phase: 'awaiting_confirmation', result, outputHash: hash });
		expect(payments.submitResult).toHaveBeenCalledWith('bc-1', hash);
		expect((await step()).phase).toBe('completed');
	});

	it('does not complete when the confirmed result hash differs from ours', async () => {
		const { step } = setup(job({ phase: 'awaiting_confirmation', result: 'x', outputHash: 'a'.repeat(64) }), [
			state({ onChainState: 'ResultSubmitted', confirmed: true, resultHash: 'b'.repeat(64) }),
		]);
		expect((await step()).phase).toBe('awaiting_confirmation');
	});

	it('fails when funds never lock before payByTime (plus grace)', async () => {
		const { step } = setup(job(), [state()], { now: NOW + 30 * MIN });
		expect(await step()).toMatchObject({ phase: 'failed', error: expect.stringMatching(/payByTime/) });
	});

	it('refuses to dial when the call could not finish before submitResultTime', async () => {
		const { step, execute } = setup(job(), [state({ onChainState: 'FundsLocked', confirmed: true })], { now: NOW + 50 * MIN });
		expect(await step()).toMatchObject({ phase: 'failed', error: expect.stringMatching(/not enough time/) });
		expect(execute).not.toHaveBeenCalled();
	});

	it('fails the job, without submitting, when the work itself errors', async () => {
		const { step, payments } = setup(job(), [state({ onChainState: 'FundsLocked', confirmed: true })], {
			execute: async () => { throw new Error('telnyx 503'); },
		});
		expect(await step()).toMatchObject({ phase: 'failed', error: expect.stringMatching(/telnyx 503/) });
		expect(payments.submitResult).not.toHaveBeenCalled();
	});

	it('resumes a job a previous process left in progress, handing the executor its saved work', async () => {
		const work = { calls: [{ to: '+15550100187', state: 'dialing' as const }] };
		const { step, execute } = setup(job({ phase: 'calling', work }), [state({ onChainState: 'FundsLocked', confirmed: true })]);
		expect((await step()).phase).toBe('awaiting_confirmation');
		expect(execute).toHaveBeenCalledWith(expect.objectContaining({ work }));
	});

	it('persists the executor\'s progress on the job as it goes', async () => {
		const { step, store } = setup(job(), [state({ onChainState: 'FundsLocked', confirmed: true })], {
			execute: async (input) => { input.save({ calls: [{ to: '+15550100187', state: 'dialing' }] }); return outcome; },
		});
		await step();
		expect(store.get(job().id)?.work).toEqual({ calls: [{ to: '+15550100187', state: 'dialing' }] });
	});

	it('after a restart mid-submit, reads the chain instead of submitting twice', async () => {
		const { step, payments } = setup(job({ phase: 'submitting', result: 'r', outputHash: 'c'.repeat(64) }), [
			state({ onChainState: 'FundsLocked', confirmed: true, nextAction: 'SubmitResultRequested' }),
		]);
		expect((await step()).phase).toBe('awaiting_confirmation');
		expect(payments.submitResult).not.toHaveBeenCalled();
	});

	it('fails when the buyer leaves the escrow before the call', async () => {
		const { step } = setup(job(), [state({ onChainState: 'RefundRequested', confirmed: true })]);
		expect(await step()).toMatchObject({ phase: 'failed', error: expect.stringMatching(/RefundRequested/) });
	});

	it('runs one call per job even if ticks overlap', async () => {
		let release!: () => void;
		const { runner, execute } = setup(job(), [state({ onChainState: 'FundsLocked', confirmed: true })], {
			execute: () => new Promise<JobOutcome>((r) => { release = () => r(outcome); }),
		});
		await runner.tick();
		await new Promise((r) => setTimeout(r, 10));
		await runner.tick();
		release();
		await runner.idle();
		expect(execute).toHaveBeenCalledTimes(1);
	});
});
