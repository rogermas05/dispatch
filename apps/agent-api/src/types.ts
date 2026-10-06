/** MIP-003: the agent API Masumi buyers talk to. */

export type JobStatus =
	| 'awaiting_payment'
	| 'awaiting_input'
	| 'running'
	| 'completed'
	| 'failed';

/**
 * A job as we track it.
 *
 * `blockchainIdentifier` ties this to an escrow in the payment service. The four
 * deadlines are issued at job start and are not ours to choose — missing
 * submitResultTime refunds the buyer and we get nothing, so they are recorded
 * here and treated as hard facts.
 */
export interface Job {
	id: string;
	status: JobStatus;
	createdAt: string;
	identifierFromPurchaser: string;
	inputData: Record<string, unknown>;
	/** SHA-256 of the input, hex. The on-chain commitment to what we were asked. */
	inputHash: string;
	blockchainIdentifier: string | null;
	payByTime: string | null;
	submitResultTime: string | null;
	unlockTime: string | null;
	externalDisputeUnlockTime: string | null;
	result?: unknown;
	/** Hex SHA-256 of the result, submitted on-chain when the work finishes. */
	outputHash?: string;
	error?: string;
}

export interface AvailabilityReport {
	status: 'available' | 'unavailable';
	type: string;
	/** Why we are refusing work. Present only when unavailable. */
	reasons?: string[];
}
