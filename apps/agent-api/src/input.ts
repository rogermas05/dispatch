import { E164 } from '../../worker/src/lib/allowlist.js';
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
/** One primary number plus up to four more per job. */
export const MAX_CALLS = 5;
const USDM_DECIMALS = 6;
export const CALL_PLANS = ['compare', 'until_resolved'] as const;
export type CallPlan = 'single' | (typeof CALL_PLANS)[number];

export const RESULT_DESCRIPTION =
	'The result is a JSON string: {status, summary, artifacts, humanFollowUp, caveats, objectiveMet, calls, research, spend}. ' +
	'status is completed | partial | unreachable | failed. artifacts holds reference numbers, quotes, names and commitments; ' +
	'humanFollowUp is what a person still has to do, or null. calls lists every call with its full transcript; research is ' +
	'the background Dispatch bought before dialing, if any.';

export const INPUT_SCHEMA = {
	input_data: [
		{
			id: 'about',
			type: 'none',
			name: 'What Dispatch does',
			data: {
				description:
					'Dispatch phones businesses on your behalf: it navigates menus, waits on hold, pursues your objective within ' +
					'the authorization you give, and returns transcripts with a structured outcome. It can call several numbers ' +
					'(compare quotes, or keep calling until resolved) and, with a research budget, hire a research agent on the ' +
					'Masumi network to prepare before dialing. ' +
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
			id: 'on_behalf_of',
			type: 'text',
			name: 'On behalf of',
			data: {
				description:
					'Who the call is for, as the person answering would recognise them. Used in the greeting so the call opens with why the phone rang.',
			},
			validations: [{ validation: 'optional', value: 'true' }, { validation: 'max', value: String(MAX_TEXT) }],
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
			id: 'additional_numbers',
			type: 'textarea',
			name: 'Additional numbers',
			data: {
				placeholder: '+14155550188, +14155550199',
				description: `Up to ${MAX_CALLS - 1} more E.164 numbers, comma-separated. Repeat a number to allow a callback.`,
			},
			validations: [{ validation: 'optional', value: 'true' }, { validation: 'max', value: '200' }],
		},
		{
			id: 'call_plan',
			type: 'radio',
			name: 'How to use several numbers',
			data: {
				values: [...CALL_PLANS],
				default: 'until_resolved',
				description:
					'compare: call every number with the same objective and compare the answers (e.g. quotes). ' +
					'until_resolved: call in order and stop once the objective is met. Ignored with a single number.',
			},
			validations: [{ validation: 'optional', value: 'true' }],
		},
		{
			id: 'research_budget_usdm',
			type: 'number',
			name: 'Research budget (tUSDM)',
			data: {
				default: 0,
				description:
					'Extra tUSDM Dispatch may spend hiring a research agent before dialing (procedures, policies, what to ask for). ' +
					'Added to the price; 0 or empty means no hiring. Every purchase is reported in the result.',
			},
			validations: [{ validation: 'optional', value: 'true' }, { validation: 'min', value: '0' }],
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

const KNOWN_FIELDS = new Set(['to', 'objective', 'authorization', 'on_behalf_of', 'context', 'max_duration_seconds', 'additional_numbers', 'call_plan', 'research_budget_usdm']);

export interface CallPolicy {
	/** E.164 numbers Dispatch may dial. null means unrestricted (mock telephony only). */
	allowedNumbers: ReadonlySet<string> | null;
	/** Largest research budget a hirer may grant, in atomic units. 0n disables research hiring. */
	maxResearchBudget?: bigint;
}

/** What a job will do: which numbers, in what pattern, and what it may spend on research. */
export interface JobPlan {
	numbers: string[];
	strategy: CallPlan;
	/** Atomic tUSDM the hirer granted for research hires; added to the price. */
	researchBudget: bigint;
}

export type ParsedInput = { ok: true; brief: CallBrief; plan: JobPlan } | { ok: false; errors: string[] };

/** Decimal tUSDM → atomic units, or null if not a valid non-negative amount with at most 6 decimals. */
function usdmToAtomic(raw: unknown): bigint | null {
	const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
	if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
	const [whole, fraction = ''] = text.split('.');
	return BigInt(whole!) * 10n ** BigInt(USDM_DECIMALS) + BigInt(fraction.padEnd(USDM_DECIMALS, '0'));
}

/** Form UIs may send a radio/option answer as a string, an array, or an index into `values`. */
function readCallPlan(raw: unknown): (typeof CALL_PLANS)[number] | null | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value === 'number') return CALL_PLANS[value] ?? null;
	return CALL_PLANS.find((p) => p === String(value).trim()) ?? null;
}

function text(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() : null;
}

/** Validate untrusted input_data into a call brief, or explain exactly what is wrong. */
export function parseCallInput(input: Record<string, unknown>, policy: CallPolicy): ParsedInput {
	const errors: string[] = [];
	const unknown = Object.keys(input).filter((k) => !KNOWN_FIELDS.has(k));
	if (unknown.length) errors.push(`unknown fields: ${unknown.join(', ')}`);

	const onBehalfOf = text(input.on_behalf_of) ?? undefined;
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

	const additional =
		input.additional_numbers === undefined || input.additional_numbers === null
			? []
			: typeof input.additional_numbers === 'string'
				? input.additional_numbers.split(',').map((n) => n.trim()).filter(Boolean)
				: null;
	if (additional === null) {
		errors.push('additional_numbers must be a comma-separated string of E.164 numbers');
	} else {
		if (additional.length > MAX_CALLS - 1) errors.push(`additional_numbers allows at most ${MAX_CALLS - 1} numbers`);
		for (const n of additional) {
			if (!E164.test(n)) errors.push(`additional number ${n} is not E.164`);
			else if (policy.allowedNumbers && !policy.allowedNumbers.has(n)) errors.push(`additional number ${n} is not a number Dispatch is permitted to call`);
		}
	}

	const plan = readCallPlan(input.call_plan);
	if (plan === null) errors.push(`call_plan must be one of: ${CALL_PLANS.join(', ')}`);

	const budget = input.research_budget_usdm === undefined || input.research_budget_usdm === null || input.research_budget_usdm === '' ? 0n : usdmToAtomic(input.research_budget_usdm);
	const maxBudget = policy.maxResearchBudget ?? 0n;
	if (budget === null) errors.push('research_budget_usdm must be a non-negative amount with at most 6 decimals');
	else if (budget > maxBudget) {
		errors.push(maxBudget === 0n ? 'research hiring is not enabled on this Dispatch instance; omit research_budget_usdm' : `research_budget_usdm may be at most ${Number(maxBudget) / 1e6}`);
	}

	if (errors.length) return { ok: false, errors };
	const numbers = [to!, ...(additional ?? [])];
	return {
		ok: true,
		plan: { numbers, strategy: numbers.length === 1 ? 'single' : (plan ?? 'until_resolved'), researchBudget: budget ?? 0n },
		brief: {
			to: to!,
			objective: objective!,
			authorization: authorization!,
			...(onBehalfOf ? { onBehalfOf } : {}),
			...(context ? { context: { notes: context } } : {}),
			maxDurationSeconds: duration,
		},
	};
}

export { parseAllowlist } from '../../worker/src/lib/allowlist.js';
