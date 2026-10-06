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

export interface SokosumiTask {
	id: string;
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
	 * Runtime commands take their Coworker key on stdin via --api-key-stdin.
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
	async readyTasks(): Promise<SokosumiTask[]> {
		// `tasks list` rejects --personal: it reads the credential's default
		// context, which for OAuth is already the Personal Workspace. Only
		// runtime start/complete and a few setup commands take the flag.
		const out = (await this.exec(['--preprod', 'tasks', 'list', '--json'], false)) as {
			tasks?: SokosumiTask[];
		};
		return (out.tasks ?? []).filter((t) => t.status === 'READY');
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
		const out = (await this.exec(['--preprod', 'tasks', 'get', taskId, '--json'], false)) as
			| { task?: SokosumiTask }
			| SokosumiTask;
		const task = (out as { task?: SokosumiTask }).task ?? (out as SokosumiTask);
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
