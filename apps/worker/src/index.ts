import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { Journal } from './lib/journal.js';
import { SokosumiClient } from './lib/sokosumi.js';
import { MockCallProvider } from './call/mock.js';
import { TelnyxCallProvider } from './call/telnyx.js';
import type { CallProvider } from './call/provider.js';
import { runBrief } from './agent.js';

/**
 * The worker. Exactly one of these runs at a time, anywhere.
 *
 * There is no server-side lease, so a second instance double-processes tasks and
 * produces duplicate charges — which judges score directly. The journal is the
 * only guard, and it is deliberately pessimistic: anything ambiguous is left for
 * a human rather than retried.
 */

const POLL_INTERVAL_MS = 10_000;
const RESULT_BYTE_LIMIT = 1024 * 1024; // Sokosumi caps result files at 1 MiB.

function required(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is not set — copy .env.example to .env.local`);
	return v;
}

function selectProvider(): CallProvider {
	const configured = process.env.TELEPHONY_PROVIDER?.trim();
	if (!configured || configured === 'mock') {
		console.warn('[dispatch] TELEPHONY_PROVIDER unset — using the mock provider. No calls will be placed.');
		return new MockCallProvider();
	}
	if (configured === 'telnyx') {
		return new TelnyxCallProvider({
			apiKey: required('TELNYX_API_KEY'),
			texmlAppId: process.env.TELNYX_TEXML_APP_ID || undefined,
			fromNumber: required('TELNYX_FROM_NUMBER'),
			model: process.env.TELNYX_MODEL,
			voice: process.env.TELNYX_VOICE,
		});
	}
	throw new Error(`unknown TELEPHONY_PROVIDER "${configured}"`);
}

async function main(): Promise<void> {
	const workerId = `${hostname()}:${process.pid}`;
	const journalDir = process.env.JOURNAL_DIR ?? join(process.cwd(), '.local', 'journal');
	const resultDir = process.env.RESULT_DIR ?? join(process.cwd(), '.local', 'results');
	mkdirSync(resultDir, { recursive: true });

	const journal = new Journal(journalDir, workerId);
	const sokosumi = new SokosumiClient({
		coworkerId: required('SOKOSUMI_COWORKER_ID'),
		runtimeKey: required('SOKOSUMI_RUNTIME_KEY'),
		personal: true,
	});
	const provider = selectProvider();

	// Refuse to start if a previous run left anything unaccounted for. Restarting
	// over an ambiguous task is exactly how a task gets charged twice.
	const stuck = journal.stuck();
	if (stuck.length > 0) {
		console.error('[dispatch] refusing to start — tasks need inspection:');
		for (const e of stuck) console.error(`  ${e.taskId}  state=${e.state} attempts=${e.attempts} worker=${e.workerId}`);
		console.error('Inspect each, then edit or remove its journal entry.');
		process.exit(1);
	}

	if (!(await provider.healthy())) {
		throw new Error(`telephony provider ${provider.name} is unhealthy — refusing to accept work`);
	}

	console.log(`[dispatch] worker ${workerId} polling every ${POLL_INTERVAL_MS / 1000}s, provider=${provider.name}`);

	const once = process.argv.includes('--once');
	for (;;) {
		try {
			for (const task of await sokosumi.readyTasks()) {
				// Journal BEFORE anything observable happens remotely.
				if (!journal.claim(task.id)) {
					console.log(`[dispatch] skipping ${task.id} — journal says do not touch`);
					continue;
				}
				await handle(task.id, { journal, sokosumi, provider, resultDir });
			}
		} catch (err) {
			console.error('[dispatch] poll failed:', err instanceof Error ? err.message : err);
		}
		if (once) break;
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
}

async function handle(
	taskId: string,
	deps: { journal: Journal; sokosumi: SokosumiClient; provider: CallProvider; resultDir: string },
): Promise<void> {
	const { journal, sokosumi, provider, resultDir } = deps;
	try {
		const started = await sokosumi.start(taskId);
		journal.advance(taskId, 'running');
		if (started.status !== 'RUNNING') {
			throw new Error(`expected RUNNING, got ${started.status}`);
		}

		const outcome = await runBrief(
			{ name: started.name ?? '', description: started.description ?? '' },
			provider,
		);

		let body = JSON.stringify(outcome, null, 2);
		if (Buffer.byteLength(body, 'utf8') > RESULT_BYTE_LIMIT) {
			// Drop turn-by-turn detail before the flat text; the summary and
			// artifacts are what the buyer actually needs.
			body = JSON.stringify({ ...outcome, transcript: { turns: [], text: outcome.transcript.text } }, null, 2);
		}
		const resultPath = join(resultDir, `${taskId}.json`);
		writeFileSync(resultPath, body, 'utf8');

		await sokosumi.complete(taskId, resultPath);
		journal.advance(taskId, 'completed', { resultPath });
		console.log(`[dispatch] ${taskId} completed — ${outcome.status}: ${outcome.summary}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		journal.advance(taskId, 'failed', { error: message });
		console.error(`[dispatch] ${taskId} failed: ${message}`);
	}
}

main().catch((err) => {
	console.error('[dispatch] fatal:', err);
	process.exit(1);
});
