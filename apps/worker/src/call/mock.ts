import type { CallProvider } from './provider.js';
import type { CallBrief, CallResult } from '../lib/types.js';

/**
 * A provider that does not dial anything.
 *
 * Exists so the whole pipeline — poll, journal, run, submit, settle — can be
 * exercised end to end before telephony credentials land, and so tests never
 * place real calls. It is deliberately honest: every transcript it returns says
 * plainly that no call occurred, because a mock that looks like a real result is
 * how fake evidence ends up in a submission.
 */
export class MockCallProvider implements CallProvider {
	readonly name = 'mock';

	constructor(private readonly behaviour: 'completed' | 'unreachable' = 'completed') {}

	async healthy(): Promise<boolean> {
		return true;
	}

	async place(brief: CallBrief): Promise<CallResult> {
		const note = `[MOCK] No call was placed. Objective was: ${brief.objective}`;
		if (this.behaviour === 'unreachable') {
			return {
				status: 'unreachable',
				durationSeconds: 0,
				transcript: { turns: [], text: note },
				recordingUrl: null,
				providerCallId: `mock-${Date.now()}`,
			};
		}
		return {
			status: 'completed',
			durationSeconds: 42,
			transcript: {
				turns: [
					{ speaker: 'agent', text: note, atSeconds: 0 },
					{ speaker: 'other', text: '[MOCK] simulated response', atSeconds: 5 },
				],
				text: note,
			},
			recordingUrl: null,
			providerCallId: `mock-${Date.now()}`,
		};
	}
}
