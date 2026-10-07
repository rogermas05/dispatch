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

/**
 * MIP-004 input hash: sha256("<identifier_from_purchaser>;" + JCS(input_data)).
 *
 * This is what Masumi buyers recompute and what the payment service commits
 * on-chain, so it must match the standard exactly. canonicalize() is JCS for
 * the JSON a buyer can send (sorted keys by UTF-16 code unit, ES number form).
 */
export function masumiInputHash(inputData: unknown, identifierFromPurchaser: string): string {
	return sha256Text(`${identifierFromPurchaser};${canonicalize(inputData)}`);
}

/** MIP-004 output hash: sha256("<identifier_from_purchaser>;" + output), output as the raw result string. */
export function masumiOutputHash(output: string, identifierFromPurchaser: string): string {
	return sha256Text(`${identifierFromPurchaser};${output}`);
}

function sha256Text(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** MIP-003 requires a 14–26 character hex nonce from the purchaser. */
export function isValidPurchaserIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-fA-F]{14,26}$/.test(value);
}
