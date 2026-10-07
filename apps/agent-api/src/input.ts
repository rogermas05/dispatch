import type { CallBrief } from '../../worker/src/lib/types.js';

/**
 * The MIP-003 input schema, and the validation that backs it.
 *
 * Other agents read this schema to decide how to hire Dispatch, so the field
 * descriptions are written for them: what each field does, and what comes back.
 * Types follow MIP-003 Attachment 01 (HTML input types); every field is required
 * unless it carries an `optional` validation.
 *
 * The schema is only a suggestion to the caller's UI. parseCallInput() is the
 * real gate, and it runs before any escrow exists — refusing a bad job is free,
 * accepting one we cannot perform burns the buyer's locked funds.
 */

export const MAX_CALL_SECONDS = 1800;
export const DEFAULT_CALL_SECONDS = 900;
const MIN_CALL_SECONDS = 60;
const MAX_TEXT = 4000;
const E164 = /^\+[1-9]\d{6,14}$/;

export const RESULT_DESCRIPTION =
	'The result is a JSON string: {status, summary, artifacts, humanFollowUp, caveats, durationSeconds, transcript}. ' +
	'status is completed | unreachable | refused | escalated | timeout. artifacts holds reference numbers, names and ' +
	'commitments obtained on the call; humanFollowUp is what a person still has to do, or null.';

export const INPUT_SCHEMA = {
	input_data: [
		{
			id: 'about',
			type: 'none',
			name: 'What Dispatch does',
			data: {
				description:
					'Dispatch places one outbound phone call to a business on your behalf, pursues your objective within the ' +
					'authorization you give, waits on hold, and returns the transcript with a structured outcome. ' +
					RESULT_DESCRIPTION,
			},
		},
		{
			id: 'to',
			type: 'tel',
			name: 'Phone number',
			data: { placeholder: '+14155550123', description: 'The business line to call, in E.164 format with country code.' },
			validations: [{ validation: 'format', value: 'tel-pattern' }],
		},
		{
			id: 'objective',
			type: 'textarea',
			name: 'Objective',
			data: {
				placeholder: 'Find out why claim 88-20417 was denied and open a reconsideration.',
				description: 'What this call must achieve, in plain language.',
			},
			validations: [{ validation: 'min', value: '10' }, { validation: 'max', value: String(MAX_TEXT) }],
		},
		{
			id: 'authorization',
			type: 'textarea',
			name: 'Authorization',
			data: {
				placeholder: 'May confirm the account holder name. May NOT agree to any payment or plan change.',
				description:
					'What Dispatch may agree to on your behalf. Anything outside this is escalated, never improvised. ' +
					'Write "Nothing: gather information only" if it may not commit to anything. This text is hashed on-chain.',
			},
			validations: [{ validation: 'min', value: '1' }, { validation: 'max', value: String(MAX_TEXT) }],
		},
		{
			id: 'context',
			type: 'textarea',
			name: 'Context',
			data: { description: 'Facts Dispatch may need on the call: account or order numbers, names, dates.' },
			validations: [{ validation: 'optional', value: 'true' }, { validation: 'max', value: String(MAX_TEXT) }],
		},
		{
			id: 'max_duration_seconds',
			type: 'number',
			name: 'Maximum call length (seconds)',
			data: { default: DEFAULT_CALL_SECONDS, description: `Ceiling on call length, including hold. Default ${DEFAULT_CALL_SECONDS}.` },
			validations: [
				{ validation: 'optional', value: 'true' },
				{ validation: 'min', value: String(MIN_CALL_SECONDS) },
				{ validation: 'max', value: String(MAX_CALL_SECONDS) },
				{ validation: 'format', value: 'integer' },
			],
		},
	],
} as const;

const KNOWN_FIELDS = new Set(['to', 'objective', 'authorization', 'context', 'max_duration_seconds']);

export interface CallPolicy {
	/** E.164 numbers Dispatch may dial. null means unrestricted (mock telephony only). */
	allowedNumbers: ReadonlySet<string> | null;
}

export type ParsedInput = { ok: true; brief: CallBrief } | { ok: false; errors: string[] };

function text(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() : null;
}

/** Validate untrusted input_data into a call brief, or explain exactly what is wrong. */
export function parseCallInput(input: Record<string, unknown>, policy: CallPolicy): ParsedInput {
	const errors: string[] = [];
	const unknown = Object.keys(input).filter((k) => !KNOWN_FIELDS.has(k));
	if (unknown.length) errors.push(`unknown fields: ${unknown.join(', ')}`);

	const to = text(input.to);
	if (!to || !E164.test(to)) {
		errors.push('to must be an E.164 phone number, e.g. +14155550123');
	} else if (policy.allowedNumbers && !policy.allowedNumbers.has(to)) {
		errors.push(`to ${to} is not a number Dispatch is permitted to call`);
	}

	const objective = text(input.objective);
	if (!objective || objective.length < 10 || objective.length > MAX_TEXT) {
		errors.push(`objective must be 10-${MAX_TEXT} characters`);
	}

	const authorization = text(input.authorization);
	if (!authorization || authorization.length > MAX_TEXT) {
		errors.push(`authorization must be 1-${MAX_TEXT} characters; write "Nothing: gather information only" to grant nothing`);
	}

	const context = input.context === undefined || input.context === null ? '' : text(input.context);
	if (context === null || context.length > MAX_TEXT) errors.push(`context must be a string of at most ${MAX_TEXT} characters`);

	// Form-based callers send numbers as strings; accept both, but only whole seconds.
	const rawDuration = input.max_duration_seconds;
	const duration =
		rawDuration === undefined || rawDuration === null || rawDuration === '' ? DEFAULT_CALL_SECONDS : Number(rawDuration);
	if (!Number.isInteger(duration) || duration < MIN_CALL_SECONDS || duration > MAX_CALL_SECONDS) {
		errors.push(`max_duration_seconds must be a whole number between ${MIN_CALL_SECONDS} and ${MAX_CALL_SECONDS}`);
	}

	if (errors.length) return { ok: false, errors };
	return {
		ok: true,
		brief: {
			to: to!,
			objective: objective!,
			authorization: authorization!,
			...(context ? { context: { notes: context } } : {}),
			maxDurationSeconds: duration,
		},
	};
}

/** Parse DISPATCH_ALLOWED_NUMBERS ("+1555..., +1555...") into a set, rejecting malformed entries loudly. */
export function parseAllowlist(raw: string | undefined): Set<string> {
	const numbers = (raw ?? '').split(',').map((n) => n.trim()).filter(Boolean);
	const bad = numbers.filter((n) => !E164.test(n));
	if (bad.length) throw new Error(`DISPATCH_ALLOWED_NUMBERS has non-E.164 entries: ${bad.join(', ')}`);
	return new Set(numbers);
}
