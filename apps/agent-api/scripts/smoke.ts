/**
 * End-to-end smoke test of the paid MIP-003 path, over real HTTP:
 *   buyer → /start_job → (escrow locks) → runner dials (mock) → report → submit-result
 *   → ResultSubmitted confirmed → /status releases the result → hashes verified (MIP-004).
 *
 * The payment service and the model API are local fakes; the agent API is the
 * real process started with real code. Run before every deploy: `npm run smoke`.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalize } from '../src/hash.js';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const body = async (req: IncomingMessage) => {
	let raw = '';
	for await (const c of req) raw += c;
	return raw ? JSON.parse(raw) : {};
};
const listen = (server: Server) =>
	new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- fake Masumi Payment Service -------------------------------------------
const escrow = { onChainState: null as string | null, resultHash: null as string | null, submitted: null as string | null };
const mps = createServer(async (req, res) => {
	const json = await body(req);
	const reply = (data: unknown) => res.end(JSON.stringify({ status: 'success', data }));
	if (req.url === '/api/v1/payment') {
		const now = Date.now();
		return reply({
			blockchainIdentifier: 'smoke-bc-1',
			payByTime: String(now + 15 * 60_000),
			submitResultTime: String(now + 60 * 60_000),
			unlockTime: String(now + 90 * 60_000),
			externalDisputeUnlockTime: String(now + 150 * 60_000),
			inputHash: json.inputHash,
		});
	}
	if (req.url === '/api/v1/payment/resolve-blockchain-identifier') {
		const confirmed = escrow.onChainState ? [{ status: 'Confirmed', newOnChainState: escrow.onChainState }] : [];
		return reply({ onChainState: escrow.onChainState, resultHash: escrow.resultHash, TransactionHistory: confirmed, NextAction: {} });
	}
	if (req.url === '/api/v1/payment/submit-result') {
		escrow.submitted = json.submitResultHash;
		return reply({});
	}
	res.statusCode = 404;
	res.end('{}');
});

// --- fake Anthropic Messages API (the report pass) ---------------------------
const model = createServer(async (req, res) => {
	await body(req);
	const report = { summary: 'Mock call reached the line; nothing real was established.', artifacts: {}, humanFollowUp: null, caveats: ['Mock telephony: no call was placed.'] };
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify({
		id: 'msg_smoke', type: 'message', role: 'assistant', model: 'smoke',
		content: [{ type: 'text', text: JSON.stringify(report) }],
		stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
	}));
});

function check(condition: unknown, message: string): void {
	if (!condition) throw new Error(`FAIL: ${message}`);
	console.log(`  ok  ${message}`);
}

async function main(): Promise<void> {
	const [mpsPort, modelPort] = [await listen(mps), await listen(model)];
	const apiPort = 3900 + Math.floor(Math.random() * 90);
	const agent = spawn('npx', ['tsx', 'src/index.ts'], {
		cwd: new URL('..', import.meta.url).pathname,
		env: {
			...process.env,
			AGENT_API_PORT: String(apiPort),
			JOBS_DIR: mkdtempSync(join(tmpdir(), 'smoke-jobs-')),
			TELEPHONY_PROVIDER: 'mock',
			ANTHROPIC_API_KEY: 'smoke',
			ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelPort}`,
			PAYMENT_SERVICE_URL: `http://127.0.0.1:${mpsPort}/api/v1`,
			MPS_PAY_KEY: 'smoke',
			AGENT_IDENTIFIER: 'a'.repeat(64),
			USDM_UNIT: 'usdm',
			RUNNER_INTERVAL_MS: '300',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let logs = '';
	agent.stdout.on('data', (d) => (logs += d));
	agent.stderr.on('data', (d) => (logs += d));
	const base = `http://127.0.0.1:${apiPort}`;

	try {
		for (let i = 0; i < 60 && !(await fetch(`${base}/availability`).then(() => true, () => false)); i++) await sleep(250);

		console.log('buyer discovers Dispatch');
		const availability = await (await fetch(`${base}/availability`)).json();
		check(availability.status === 'available', `/availability is available (${JSON.stringify(availability.reasons ?? [])})`);
		const schema = await (await fetch(`${base}/input_schema`)).json();
		check(schema.input_data.some((f: { id: string }) => f.id === 'to'), '/input_schema describes the phone number field');

		console.log('buyer hires Dispatch');
		const nonce = 'c0ffee00c0ffee';
		const input = { to: '+15550100187', objective: 'Ask the depot why shipment SH-7731 was not delivered.', authorization: 'Nothing: gather information only.' };
		const start = await (await fetch(`${base}/start_job`, { method: 'POST', body: JSON.stringify({ identifier_from_purchaser: nonce, input_data: input }) })).json();
		check(start.blockchainIdentifier === 'smoke-bc-1' && typeof start.payByTime === 'number', 'start_job returns escrow terms');
		check(start.input_hash === sha(`${nonce};${canonicalize(input)}`), 'input_hash follows MIP-004');

		await sleep(1000);
		check(escrow.submitted === null, 'nothing happens before funds lock');

		console.log('buyer locks funds');
		escrow.onChainState = 'FundsLocked';
		for (let i = 0; i < 80 && !escrow.submitted; i++) await sleep(250);
		check(escrow.submitted, 'runner placed the call and submitted a result hash');
		const status1 = await (await fetch(`${base}/status?job_id=${start.id}`)).json();
		check(status1.status === 'running' && status1.result === undefined, 'result is withheld until the hash is confirmed');

		console.log('chain confirms the result');
		escrow.onChainState = 'ResultSubmitted';
		escrow.resultHash = escrow.submitted;
		let status: { status: string; result?: string } = status1;
		for (let i = 0; i < 40 && status.status !== 'completed'; i++) {
			await sleep(250);
			status = await (await fetch(`${base}/status?job_id=${start.id}`)).json();
		}
		check(status.status === 'completed' && typeof status.result === 'string', '/status completes and releases the result');
		check(sha(`${nonce};${status.result}`) === escrow.submitted, 'result matches the on-chain output hash (MIP-004)');
		const outcome = JSON.parse(status.result!);
		check(outcome.summary && Array.isArray(outcome.transcript.turns), 'result is a structured CallOutcome');
		console.log('\nPASS: paid MIP-003 path works end to end');
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		console.error('\n--- agent-api logs ---\n' + logs);
		process.exitCode = 1;
	} finally {
		agent.kill('SIGTERM');
		mps.close();
		model.close();
	}
}

void main();
