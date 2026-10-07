import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Prepaid balances, as an append-only ledger.
 *
 * A balance is never stored: it is the sum of a handle's entries, so every cent
 * has a reason and a reference. (reason, reference) is unique, which is what
 * makes a replayed Stripe webhook or a repeated refund harmless.
 *
 * One JSON line per entry, written before memory is updated. Single process
 * only — two writers on the same file would each miss the other's entries.
 */

export type LedgerReason = 'topup' | 'job' | 'refund';

export interface LedgerEntry {
	handle: string;
	/** Positive adds, negative spends. Whole cents. */
	amountCents: number;
	reason: LedgerReason;
	/** Stripe session id for a top-up; the job key for a job and its refund. */
	reference: string;
	at: string;
}

/** One account per iMessage address: phone numbers and emails compare case- and space-insensitively. */
export function normalizeHandle(raw: string): string {
	return raw.replace(/\s+/g, '').toLowerCase();
}

const key = (reason: LedgerReason, reference: string) => `${reason}:${reference}`;

export class Ledger {
	private readonly entries: LedgerEntry[] = [];
	private readonly keys = new Set<string>();

	/** Without a file the ledger lives in memory only (tests). */
	constructor(
		private readonly file?: string,
		private readonly now: () => Date = () => new Date(),
	) {
		if (!file || !existsSync(file)) return;
		for (const line of readFileSync(file, 'utf8').split('\n')) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as LedgerEntry;
			this.entries.push(entry);
			this.keys.add(key(entry.reason, entry.reference));
		}
	}

	balance(handle: string): number {
		const h = normalizeHandle(handle);
		return this.entries.reduce((sum, e) => (e.handle === h ? sum + e.amountCents : sum), 0);
	}

	/** Add a paid top-up. False when this reference was already credited. */
	topUp(handle: string, amountCents: number, reference: string): boolean {
		if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`invalid top-up amount: ${amountCents}`);
		return this.append(handle, amountCents, 'topup', reference);
	}

	/** Spend on a job. False when the balance does not cover it or the job was already charged. */
	charge(handle: string, amountCents: number, jobKey: string): boolean {
		if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`invalid charge amount: ${amountCents}`);
		if (this.balance(handle) < amountCents) return false;
		return this.append(handle, -amountCents, 'job', jobKey);
	}

	/** Give back exactly what a job was charged. False when there is no such charge or it was already refunded. */
	refund(handle: string, jobKey: string): boolean {
		const h = normalizeHandle(handle);
		const charged = this.entries.find((e) => e.handle === h && e.reason === 'job' && e.reference === jobKey);
		if (!charged) return false;
		return this.append(handle, -charged.amountCents, 'refund', jobKey);
	}

	private append(handle: string, amountCents: number, reason: LedgerReason, reference: string): boolean {
		const k = key(reason, reference);
		if (this.keys.has(k)) return false;
		const entry: LedgerEntry = { handle: normalizeHandle(handle), amountCents, reason, reference, at: this.now().toISOString() };
		if (this.file) {
			mkdirSync(dirname(this.file), { recursive: true });
			appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
		}
		this.entries.push(entry);
		this.keys.add(k);
		return true;
	}
}
