import { createHash } from 'node:crypto';

/**
 * SHA-256, hex-encoded — the input/output hash convention Masumi logs on-chain.
 *
 * Decision logging proves integrity, not correctness: a hash match proves we
 * delivered exactly what we committed to the ledger. It says nothing about
 * whether the result was good. For Dispatch the input hash pins what we were
 * authorized to do and the output hash pins the transcript, which is what makes
 * a contested call checkable afterwards.
 *
 * Keys are sorted so the same logical input always hashes identically — a hash
 * that depends on property order would make the on-chain commitment unverifiable
 * by anyone who rebuilt the object.
 */
export function sha256Hex(value: unknown): string {
	return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export function canonicalize(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

/** MIP-003 requires a 14–26 character hex nonce from the purchaser. */
export function isValidPurchaserIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-fA-F]{14,26}$/.test(value);
}
