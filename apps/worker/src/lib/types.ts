/** Shared shapes for a Dispatch job: a brief in, a call outcome out. */

/** What the buyer asked for. Parsed out of the Sokosumi task description. */
export interface CallBrief {
	/** E.164 number to dial. */
	to: string;
	/** What the call is meant to achieve, in the buyer's words. */
	objective: string;
	/**
	 * What the agent may commit to on the caller's behalf. Anything outside this
	 * is escalated rather than improvised — this is the text whose hash goes
	 * on-chain, so it is the record of what we were actually authorized to do.
	 */
	authorization: string;
	/**
	 * Who the call is being made for, as the person answering would recognise
	 * them — "Aman", "your son Aman", "a customer". Used in the greeting, which
	 * should explain why the phone rang rather than what is on the other end.
	 */
	onBehalfOf?: string;
	/** Facts the agent may need mid-call: account numbers, names, dates. */
	context?: Record<string, string>;
	/** Hard ceiling on call length. Guards submitResultTime. */
	maxDurationSeconds: number;
}

export type CallStatus =
	| 'completed'      // objective pursued to a conclusion
	| 'unreachable'    // never connected
	| 'refused'        // other party declined to engage
	| 'escalated'      // hit the edge of its authorization
	| 'timeout';       // hit maxDurationSeconds

export interface Transcript {
	turns: Array<{ speaker: 'agent' | 'other'; text: string; atSeconds: number }>;
	text: string;
}

/** What a provider returns once the call is over. */
export interface CallResult {
	status: CallStatus;
	durationSeconds: number;
	transcript: Transcript;
	/** External URL. Audio never goes in the result file — 1 MiB cap. */
	recordingUrl: string | null;
	providerCallId: string;
}

/** The deliverable. Serialized to the Sokosumi result file. */
export interface CallOutcome extends CallResult {
	/** Did the objective get met, in one line. */
	summary: string;
	/** Reference numbers, confirmations, names — what makes the call reusable. */
	artifacts: Record<string, string>;
	/** What a human still has to do, if anything. */
	humanFollowUp: string | null;
	/** Whether the call achieved its objective. Drives "call until resolved" jobs. */
	objectiveMet?: boolean;
	/**
	 * What we cannot prove. The protocol proves we delivered what we committed;
	 * it cannot prove the other party told the truth.
	 */
	caveats: string[];
}
