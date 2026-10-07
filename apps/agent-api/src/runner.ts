import type { ExecuteInput, JobOutcome } from './execute.js';
import { canonicalize, masumiOutputHash } from './hash.js';
import type { CallPolicy, ParsedInput } from './input.js';
import type { PaymentState } from './payment.js';
import type { JobStore } from './store.js';
import type { Job, JobPhase } from './types.js';

/**
 * Drives paid MIP-003 jobs from locked funds to a confirmed result.
 *
 * The escrow state is the only green light: nothing is dialed until the payment
 * service reports a *confirmed* FundsLocked. Every phase is persisted before the
 * external action it names (see JobPhase), and anything ambiguous after a crash
 * fails safe — a call is never re-dialed, because the first attempt may already
 * have reached a real person.
 */

export interface RunnerDeps {
	store: JobStore;
	payments: {
		resolve(blockchainIdentifier: string): Promise<PaymentState>;
		submitResult(blockchainIdentifier: string, resultHash: string): Promise<void>;
	};
	parse: (input: Record<string, unknown>, policy: CallPolicy) => ParsedInput;
	policy: CallPolicy;
	/** Run the job's research and calls and produce the deliverable (see execute.ts). */
	execute: (input: ExecuteInput) => Promise<JobOutcome>;
	maxConcurrentCalls?: number;
	now?: () => number;
	log?: (message: string) => void;
}

/** Headroom kept before submitResultTime for reporting and the submit transaction. */
export const SUBMIT_MARGIN_MS = 3 * 60_000;
/** How long after payByTime we keep waiting for a late FundsLocked to confirm. */
const PAYMENT_GRACE_MS = 10 * 60_000;
const BUYER_EXIT_STATES = new Set(['RefundRequested', 'Disputed', 'RefundAuthorized', 'RefundWithdrawn', 'DisputedWithdrawn']);
const TERMINAL: ReadonlySet<JobPhase> = new Set(['completed', 'failed']);

export class JobRunner {
	private readonly inFlight = new Map<string, Promise<void>>();
	private activeCalls = 0;
	private readonly now: () => number;
	private readonly log: (message: string) => void;
	private timer: NodeJS.Timeout | null = null;

	constructor(private readonly deps: RunnerDeps) {
		this.now = deps.now ?? Date.now;
		this.log = deps.log ?? ((m) => console.log(`[dispatch-runner] ${m}`));
	}

	/** Advance every open job once. Calls run in the background; everything else is awaited. */
	async tick(): Promise<void> {
		const open = this.deps.store.list().filter((j) => !TERMINAL.has(j.phase) && !this.inFlight.has(j.id));
		await Promise.all(
			open.map((job) => {
				const run = this.advance(job)
					.catch((err) => this.log(`${job.id}: ${err instanceof Error ? err.message : err}`))
					.finally(() => this.inFlight.delete(job.id));
				this.inFlight.set(job.id, run);
				return job.phase === 'awaiting_payment' ? Promise.race([run, Promise.resolve()]) : run;
			}),
		);
	}

	start(intervalMs = 15_000): void {
		// Jobs left in 'calling' by a previous process resume on the first tick;
		// the executor marks any call that was mid-dial as interrupted, never re-dialing it.
		this.timer = setInterval(() => void this.tick(), intervalMs);
		void this.tick();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}

	/** Wait for background calls (tests and graceful shutdown). */
	async idle(): Promise<void> {
		await Promise.all(this.inFlight.values());
	}

	private save(job: Job, patch: Partial<Job>): Job {
		return this.deps.store.put({ ...job, ...patch });
	}

	private fail(job: Job, error: string): Job {
		this.log(`${job.id} failed: ${error}`);
		return this.save(job, { phase: 'failed', error });
	}

	private async advance(job: Job): Promise<void> {
		switch (job.phase) {
			case 'awaiting_payment':
				return this.awaitPayment(job);
			case 'calling':
				// Only reachable for a job a previous process left behind: resume it.
				return this.work(job);
			case 'result_ready':
				return this.submit(job);
			case 'submitting':
				return this.recoverSubmit(job);
			case 'awaiting_confirmation':
				return this.awaitConfirmation(job);
			default:
				return;
		}
	}

	private async awaitPayment(job: Job): Promise<void> {
		const state = await this.deps.payments.resolve(job.blockchainIdentifier);
		job = this.save(job, { lastOnChainState: state.onChainState });

		if (state.onChainState && BUYER_EXIT_STATES.has(state.onChainState)) {
			this.fail(job, `buyer left the escrow before the call (${state.onChainState})`);
			return;
		}
		if (state.onChainState !== 'FundsLocked' || !state.confirmed) {
			if (this.now() > Number(job.payByTime) + PAYMENT_GRACE_MS) this.fail(job, 'funds were not locked before payByTime');
			return;
		}

		return this.work(job);
	}

	/** Run (or resume) the job's research and calls, then hand the deliverable to submit(). */
	private async work(job: Job): Promise<void> {
		const parsed = this.deps.parse(job.inputData, this.deps.policy);
		if (!parsed.ok) {
			this.fail(job, `input no longer valid: ${parsed.errors.join('; ')}`);
			return;
		}
		const mustFinishBy = Number(job.submitResultTime) - SUBMIT_MARGIN_MS;
		if (job.phase === 'awaiting_payment' && this.now() + parsed.brief.maxDurationSeconds * 1000 > mustFinishBy) {
			this.fail(job, 'not enough time left to finish a call before submitResultTime; refusing to dial');
			return;
		}
		if (this.activeCalls >= (this.deps.maxConcurrentCalls ?? 2)) return; // picked up on a later tick

		this.activeCalls += 1;
		if (job.phase !== 'calling') job = this.save(job, { phase: 'calling' });
		let outcome: JobOutcome;
		try {
			this.log(`${job.id}: funds locked, working`);
			outcome = await this.deps.execute({
				brief: parsed.brief,
				plan: parsed.plan,
				work: job.work,
				jobId: job.id,
				mustFinishBy,
				save: (work) => {
					job = this.save(this.deps.store.get(job.id) ?? job, { work });
				},
			});
		} catch (err) {
			this.fail(this.deps.store.get(job.id) ?? job, `job could not be completed: ${err instanceof Error ? err.message : err}`);
			return;
		} finally {
			this.activeCalls -= 1;
		}
		job = this.deps.store.get(job.id) ?? job;

		const result = canonicalize(outcome);
		job = this.save(job, {
			phase: 'result_ready',
			result,
			outputHash: masumiOutputHash(result, job.identifierFromPurchaser),
		});
		return this.submit(job);
	}

	private async submit(job: Job): Promise<void> {
		if (this.now() >= Number(job.submitResultTime)) {
			this.fail(job, 'submitResultTime passed before the result could be submitted');
			return;
		}
		job = this.save(job, { phase: 'submitting' });
		await this.deps.payments.submitResult(job.blockchainIdentifier, job.outputHash!);
		this.save(job, { phase: 'awaiting_confirmation' });
		this.log(`${job.id}: result hash submitted`);
	}

	/** A restart found a submit that may or may not have reached MPS. Ask the chain before repeating it. */
	private async recoverSubmit(job: Job): Promise<void> {
		const state = await this.deps.payments.resolve(job.blockchainIdentifier);
		const alreadySent =
			state.resultHash === job.outputHash ||
			state.nextAction === 'SubmitResultRequested' ||
			state.nextAction === 'SubmitResultInitiated';
		if (alreadySent) {
			this.save(job, { phase: 'awaiting_confirmation', lastOnChainState: state.onChainState });
			return;
		}
		return this.submit(job);
	}

	private async awaitConfirmation(job: Job): Promise<void> {
		const state = await this.deps.payments.resolve(job.blockchainIdentifier);
		if (state.onChainState === 'ResultSubmitted' && state.confirmed && state.resultHash === job.outputHash) {
			this.save(job, { phase: 'completed', lastOnChainState: state.onChainState });
			this.log(`${job.id}: result confirmed on-chain`);
			return;
		}
		if (state.onChainState !== job.lastOnChainState) this.save(job, { lastOnChainState: state.onChainState });
	}
}
