/** MIP-003: the agent API Masumi buyers talk to. */

export type JobStatus =
	| 'awaiting_payment'
	| 'awaiting_input'
	| 'running'
	| 'completed'
	| 'failed';

/**
 * Where a paid job is in its lifecycle. Each phase is persisted *before* the
 * external action it names, so a restart always knows what might already have
 * happened remotely:
 *
 *   awaiting_payment      terms issued; waiting for a confirmed FundsLocked
 *   calling               about to dial / dialing. Found on restart, it is never
 *                         re-dialed: we may have reached a real person already.
 *   result_ready          outcome and MIP-004 output hash saved, not yet submitted
 *   submitting            submit-result sent or about to be; restart re-reads chain state
 *   awaiting_confirmation submitted; waiting for a confirmed ResultSubmitted
 *   completed             result hash confirmed on-chain; result released to the buyer
 *   failed                terminal; `error` says why
 */
export type JobPhase =
	| 'awaiting_payment'
	| 'calling'
	| 'result_ready'
	| 'submitting'
	| 'awaiting_confirmation'
	| 'completed'
	| 'failed';

/**
 * A job as we track it.
 *
 * `blockchainIdentifier` ties this to an escrow in the payment service. The four
 * deadlines are issued at job start and are not ours to choose — missing
 * submitResultTime refunds the buyer and we get nothing, so they are recorded
 * here and treated as hard facts. Times are Unix milliseconds, as MPS returns them.
 */
export interface Job {
	id: string;
	phase: JobPhase;
	createdAt: string;
	updatedAt: string;
	identifierFromPurchaser: string;
	inputData: Record<string, unknown>;
	/** MIP-004 input hash: the on-chain commitment to what we were asked. */
	inputHash: string;
	blockchainIdentifier: string;
	payByTime: string;
	submitResultTime: string;
	unlockTime: string;
	externalDisputeUnlockTime: string;
	/** The deliverable: the CallOutcome as a canonical JSON string, exactly what was hashed. */
	result?: string;
	/** MIP-004 output hash of `result`, submitted on-chain. */
	outputHash?: string;
	lastOnChainState?: string | null;
	error?: string;
}

export function statusOf(phase: JobPhase): JobStatus {
	switch (phase) {
		case 'awaiting_payment':
			return 'awaiting_payment';
		case 'completed':
			return 'completed';
		case 'failed':
			return 'failed';
		default:
			return 'running';
	}
}

export interface AvailabilityReport {
	status: 'available' | 'unavailable';
	type: string;
	/** Why we are refusing work. Present only when unavailable. */
	reasons?: string[];
}
