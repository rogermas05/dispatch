import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

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

export interface SokosumiConfig {
	coworkerId: string;
	runtimeKey: string;
	/** Personal Workspace. Organization tasks would need --organization-slug. */
	personal: boolean;
	cliPath?: string;
}

export class SokosumiClient {
	constructor(private readonly cfg: SokosumiConfig) {}

	private async exec(args: string[], withRuntimeKey: boolean): Promise<unknown> {
		const bin = this.cfg.cliPath ?? 'npx';
		const argv = bin === 'npx' ? ['sokosumi', ...args] : args;
		const env = { ...process.env };
		if (withRuntimeKey) env.SOKOSUMI_API_KEY = this.cfg.runtimeKey;

		const { stdout } = await run(bin, argv, {
			env,
			maxBuffer: 16 * 1024 * 1024,
		});
		return JSON.parse(stdout);
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
		const out = (await this.exec(
			['--preprod', 'tasks', 'list', ...this.scope(), '--json'],
			false,
		)) as { tasks?: SokosumiTask[] };
		return (out.tasks ?? []).filter((t) => t.status === 'READY');
	}

	async start(taskId: string): Promise<SokosumiTask> {
		const out = (await this.exec(
			['--preprod', 'runtime', 'start', taskId, '--coworker-id', this.cfg.coworkerId, ...this.scope(), '--json'],
			true,
		)) as { task?: SokosumiTask };
		if (!out.task) throw new Error(`runtime start returned no task for ${taskId}`);
		return out.task;
	}

	async complete(taskId: string, resultFile: string): Promise<SokosumiTask> {
		const out = (await this.exec(
			['--preprod', 'runtime', 'complete', taskId, '--coworker-id', this.cfg.coworkerId, ...this.scope(), '--result-file', resultFile, '--json'],
			true,
		)) as { task?: SokosumiTask };
		if (!out.task) throw new Error(`runtime complete returned no task for ${taskId}`);
		return out.task;
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
