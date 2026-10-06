import type { CallBrief, CallResult } from '../lib/types.js';

/**
 * A telephony provider. Dispatch does not care which one.
 *
 * The real-time audio loop is the one part of this product we do not build —
 * providers like Vapi handle barge-in, latency and transcription. Keeping this
 * interface narrow means swapping providers is a config change, not a rewrite,
 * which matters because telephony is the one live external dependency that can
 * fail on demo day.
 */
export interface CallProvider {
	readonly name: string;
	/** Cheap readiness check. Gates paid jobs — see MIP-003 /availability. */
	healthy(): Promise<boolean>;
	place(brief: CallBrief): Promise<CallResult>;
}

/** Thrown when the provider itself failed, as distinct from the call going badly. */
export class ProviderError extends Error {
	constructor(message: string, readonly retryable: boolean) {
		super(message);
		this.name = 'ProviderError';
	}
}
