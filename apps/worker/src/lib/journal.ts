import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task journal — the only protection against double-processing that exists.
 *
 * Sokosumi has no worker lease and no claim endpoint (verified; see
 * docs/FINDINGS.md §3). Nothing server-side stops two processes starting the
 * same task, and duplicate charges are an explicit judging criterion. So we
 * journal locally, and we journal *before* doing anything observable.
 *
 * Entries are append-only files, one per task. Crash-safety matters more than
 * speed here: a task we started but cannot account for must be inspected by a
 * human, never silently retried.
 */

export type JournalState =
	| 'claimed'    // we intend to run it; written before any remote call
	| 'running'    // Sokosumi confirmed RUNNING
	| 'completed'  // result submitted and accepted
	| 'failed';    // ran, did not succeed; safe to inspect

export interface JournalEntry {
	taskId: string;
	state: JournalState;
	claimedAt: string;
	updatedAt: string;
	/** Which process holds it. Distinguishes our own crash from a second worker. */
	workerId: string;
	attempts: number;
	error?: string;
	resultPath?: string;
}

export class Journal {
	constructor(
		private readonly dir: string,
		private readonly workerId: string,
	) {
		mkdirSync(this.dir, { recursive: true });
	}

	private path(taskId: string): string {
		return join(this.dir, `${taskId}.json`);
	}

	read(taskId: string): JournalEntry | null {
		const p = this.path(taskId);
		if (!existsSync(p)) return null;
		return JSON.parse(readFileSync(p, 'utf8')) as JournalEntry;
	}

	private write(entry: JournalEntry): void {
		// Write to a temp file and rename: a half-written journal entry is worse
		// than no entry, because it looks like a task nobody owns.
		const p = this.path(entry.taskId);
		const tmp = `${p}.tmp`;
		writeFileSync(tmp, JSON.stringify(entry, null, 2), { mode: 0o600 });
		renameSync(tmp, p); // atomic on the same filesystem
	}

	/**
	 * Attempt to claim a task. Returns null if we must not touch it.
	 *
	 * Refuses anything already terminal, and refuses anything another worker
	 * claimed — we would rather leave a task unclaimed than charge twice.
	 */
	claim(taskId: string): JournalEntry | null {
		const existing = this.read(taskId);

		if (existing) {
			if (existing.state === 'completed') return null;
			if (existing.state === 'running') {
				// Either we crashed mid-run, or a second worker is live right now.
				// We cannot tell these apart from here, and guessing wrong means a
				// duplicate charge. Leave it for a human.
				return null;
			}
			if (existing.workerId !== this.workerId && existing.state === 'claimed') {
				return null;
			}
		}

		const now = new Date().toISOString();
		const entry: JournalEntry = {
			taskId,
			state: 'claimed',
			claimedAt: existing?.claimedAt ?? now,
			updatedAt: now,
			workerId: this.workerId,
			attempts: (existing?.attempts ?? 0) + 1,
		};
		this.write(entry);
		return entry;
	}

	advance(taskId: string, state: JournalState, patch: Partial<JournalEntry> = {}): void {
		const existing = this.read(taskId);
		if (!existing) throw new Error(`cannot advance unjournalled task ${taskId}`);
		this.write({ ...existing, ...patch, state, updatedAt: new Date().toISOString() });
	}

	/** Tasks left in a state that needs a human before the worker runs again. */
	stuck(): JournalEntry[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as JournalEntry)
			.filter((e) => e.state === 'running' || (e.state === 'failed' && e.attempts > 1));
	}
}
