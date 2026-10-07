import { spawn } from 'node:child_process';

/**
 * Thin wrapper over the Sokosumi CLI.
 *
 * We shell out rather than call the HTTP API directly because the CLI is the
 * only documented surface — per-subcommand --help is not implemented and the
 * published docs are the SKILL.md files inside the package. Reimplementing its
 * auth and endpoints from observation would be guesswork we cannot verify.
 *
 * Runtime calls use the Coworker-scoped key, never human OAuth. The CLI enforces
 * this too, and the separation is deliberate: the agent process handles
 * untrusted input and must not hold credentials that can do more than run tasks.
 */

const API_BASE = 'https://api.preprod.sokosumi.com';

export interface SokosumiTask {
	id: string;
	coworkerId?: string;
	name?: string;
	description?: string;
	status: 'READY' | 'RUNNING' | 'COMPLETED' | 'INPUT_REQUIRED' | string;
}

/**
 * Response from runtime start/complete. Flat, not nested under `task` — and the
 * eventId matters: submissions must cite the payment event IDs for a completed
 * task, so it is captured rather than discarded.
 */
export interface RuntimeResult {
	taskId: string;
	eventId: string;
	status: string;
	result?: string;
}

export interface SokosumiConfig {
	coworkerId: string;
	runtimeKey: string;
	/** Personal Workspace. Organization tasks would need --organization-slug. */
	personal: boolean;
	cliPath?: string;
}

export class SokosumiClient {
	constructor(private readonly cfg: SokosumiConfig) {}

	/**
	 * Run the CLI and parse its JSON.
	 *
	 * Every call takes the Coworker key on stdin via --api-key-stdin. In a
	 * container there is no stored OAuth session, so task reads cannot fall back
	 * to it — and SOKOSUMI_API_KEY is rejected outright with "Coworker API keys
	 * are not supported by the CLI", so stdin is the only route that works for
	 * both reads and runtime calls.
	 * SOKOSUMI_API_KEY does not work for them — the CLI looks for a key stored
	 * against the specific Coworker and rejects the environment variable — and
	 * stdin keeps the secret out of the process table, where an argv flag would
	 * expose it to anything that can read /proc or run `ps`.
	 */
	private async exec(args: string[], withRuntimeKey: boolean): Promise<unknown> {
		const bin = this.cfg.cliPath ?? 'npx';
		const argv = [...(bin === 'npx' ? ['sokosumi'] : []), ...args];
		if (withRuntimeKey) argv.push('--api-key-stdin');

		return new Promise((resolve, reject) => {
			const child = spawn(bin, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (d) => (stdout += d));
			child.stderr.on('data', (d) => (stderr += d));
			child.on('error', reject);
			child.on('close', (code) => {
				if (code !== 0) {
					return reject(new Error(`sokosumi ${args.join(' ')} exited ${code}: ${stderr || stdout}`.trim()));
				}
				try {
					resolve(JSON.parse(stdout));
				} catch {
					reject(new Error(`sokosumi ${args.join(' ')} returned non-JSON: ${stdout.slice(0, 300)}`));
				}
			});
			if (withRuntimeKey) child.stdin.write(`${this.cfg.runtimeKey}\n`);
			child.stdin.end();
		});
	}

	private scope(): string[] {
		return this.cfg.personal ? ['--personal'] : [];
	}

	/**
	 * Tasks waiting to be run.
	 *
	 * This is a plain list, not a claim. There is no lease — two workers calling
	 * this both see the same task. Deduplication is the journal's job.
	 */
	/**
	 * Read Core directly rather than through the CLI.
	 *
	 * The CLI refuses a Coworker key for anything but runtime commands —
	 * "Coworker API keys are not supported by the CLI" — and falls back to a
	 * stored OAuth session, which exists on a developer laptop and does not
	 * exist in a container. Core's REST API accepts the same key over Bearer
	 * auth, so the deployed worker talks to it directly. This also drops an npx
	 * subprocess from every poll.
	 */
	private async http<T>(path: string): Promise<T> {
		const res = await fetch(`${API_BASE}${path}`, {
			headers: { Authorization: `Bearer ${this.cfg.runtimeKey}` },
		});
		if (!res.ok) throw new Error(`sokosumi GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
		return (await res.json()) as T;
	}

	async readyTasks(): Promise<SokosumiTask[]> {
		const out = await this.http<{ data?: SokosumiTask[] }>('/v1/tasks');
		return (out.data ?? []).filter(
			(t) => t.status === 'READY' && (!t.coworkerId || t.coworkerId === this.cfg.coworkerId),
		);
	}

	async start(taskId: string): Promise<RuntimeResult> {
		const out = (await this.exec(
			['--preprod', 'runtime', 'start', taskId, '--coworker-id', this.cfg.coworkerId, ...this.scope(), '--json'],
			true,
		)) as RuntimeResult;
		if (out.status !== 'RUNNING') throw new Error(`runtime start returned status ${out.status} for ${taskId}`);
		return out;
	}

	async complete(taskId: string, resultFile: string): Promise<RuntimeResult> {
		const out = (await this.exec(
			['--preprod', 'runtime', 'complete', taskId, '--coworker-id', this.cfg.coworkerId, ...this.scope(), '--result-file', resultFile, '--json'],
			true,
		)) as RuntimeResult;
		if (out.status !== 'COMPLETED') throw new Error(`runtime complete returned status ${out.status} for ${taskId}`);
		return out;
	}

	/** The task's authoritative brief, plus any human comments already on it. */
	async describe(taskId: string): Promise<SokosumiTask> {
		const out = await this.http<{ data?: SokosumiTask } | SokosumiTask>(`/v1/tasks/${taskId}`);
		const task = (out as { data?: SokosumiTask }).data ?? (out as SokosumiTask);
		if (!task?.id) throw new Error(`tasks get returned no task for ${taskId}`);
		return task;
	}

	/**
	 * Payment receipt as Core reports it.
	 *
	 * Corroboration, not proof. A settled receipt can carry a null txHash, and an
	 * error means unknown rather than unpaid — so Checkpoint 4 verifies seller
	 * receipt against the chain directly, never against this.
	 */
	async receipt(taskId: string): Promise<{ settled: boolean; txHash: string | null }> {
		const out = (await this.exec(
			['--preprod', 'runtime', 'receipt', taskId, '--coworker-id', this.cfg.coworkerId, '--json'],
			true,
		)) as { receipt?: { settled?: boolean; txHash?: string | null } };
		return {
			settled: out.receipt?.settled === true,
			txHash: out.receipt?.txHash ?? null,
		};
	}
}
