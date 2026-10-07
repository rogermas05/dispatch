import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from './types.js';

/**
 * Durable job store: one JSON file per job, written by atomic rename.
 *
 * Jobs outlive the process by hours — a call, then a result deadline, then a
 * dispute window — and a restart in between must not lose what we were asked or
 * what we delivered, because both are committed on-chain. The payment service
 * owns escrow state; this owns the job's input, phase and result.
 *
 * In production JOBS_DIR must sit on a persistent volume.
 */
export class JobStore {
	constructor(private readonly dir: string) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	private path(id: string): string {
		if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`invalid job id ${id}`);
		return join(this.dir, `${id}.json`);
	}

	get(id: string): Job | undefined {
		let p: string;
		try {
			p = this.path(id);
		} catch {
			return undefined;
		}
		return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Job) : undefined;
	}

	/** Persist a job. Returns the stored copy with updatedAt refreshed. */
	put(job: Job): Job {
		const stored = { ...job, updatedAt: new Date().toISOString() };
		const p = this.path(job.id);
		const tmp = `${p}.tmp`;
		writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
		renameSync(tmp, p);
		return stored;
	}

	list(): Job[] {
		return readdirSync(this.dir)
			.filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))
			.map((f) => JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Job);
	}

	findByPurchaserIdentifier(identifier: string): Job | undefined {
		return this.list().find((j) => j.identifierFromPurchaser === identifier);
	}
}
