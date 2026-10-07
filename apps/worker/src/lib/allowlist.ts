/**
 * Which numbers Dispatch may dial. One rule for every way in — Sokosumi tasks
 * and Masumi agent hires — because the Telnyx account is shared with a
 * production healthcare system and calls must only reach lines we own or that
 * have consented.
 */

export const E164 = /^\+[1-9]\d{6,14}$/;

/** Parse DISPATCH_ALLOWED_NUMBERS ("+1555..., +1555...") into a set, rejecting malformed entries loudly. */
export function parseAllowlist(raw: string | undefined): Set<string> {
	const numbers = (raw ?? '').split(',').map((n) => n.trim()).filter(Boolean);
	const bad = numbers.filter((n) => !E164.test(n));
	if (bad.length) throw new Error(`DISPATCH_ALLOWED_NUMBERS has non-E.164 entries: ${bad.join(', ')}`);
	return new Set(numbers);
}

/**
 * The allowlist for this process: unrestricted only for the mock provider,
 * which dials nothing. With real telephony an empty list means dial nothing.
 */
export function allowlistFromEnv(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> | null {
	const provider = (env.TELEPHONY_PROVIDER ?? 'mock').trim();
	return provider === 'mock' || provider === '' ? null : parseAllowlist(env.DISPATCH_ALLOWED_NUMBERS);
}

export class NumberNotAllowedError extends Error {
	constructor(readonly number: string) {
		super(`${number} is not a number Dispatch is permitted to call`);
		this.name = 'NumberNotAllowedError';
	}
}
