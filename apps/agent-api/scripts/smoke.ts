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

// --- fake research agent (another seller on Masumi) ---------------------------
const RESEARCH_AGENT = 'd'.repeat(64);
const RESEARCH_ANSWER = 'LTL pallet freight typically costs 150-300 USD per pallet; ask for liftgate and residential surcharges.';
const research = { nonce: '', purchased: false, purchaseAmounts: null as unknown };
const researchAgent = createServer(async (req, res) => {
	const json = await body(req);
	res.setHeader('content-type', 'application/json');
	if (req.url === '/input_schema') return res.end(JSON.stringify({ input_data: [{ id: 'prompt', type: 'textarea', name: 'Prompt' }] }));
	if (req.url === '/start_job') {
		research.nonce = json.identifier_from_purchaser;
		const now = Date.now();
		return res.end(JSON.stringify({
			id: 'research-job', blockchainIdentifier: 'smoke-research-bc', agentIdentifier: RESEARCH_AGENT, sellerVKey: 'vk',
			payByTime: now + 600_000, submitResultTime: now + 1_200_000, unlockTime: now + 1_800_000, externalDisputeUnlockTime: now + 2_400_000,
			input_hash: sha(`${research.nonce};${canonicalize(json.input_data)}`),
		}));
	}
	if (req.url?.startsWith('/status')) {
		return res.end(JSON.stringify(research.purchased ? { status: 'completed', result: RESEARCH_ANSWER } : { status: 'awaiting_payment' }));
	}
	res.statusCode = 404;
	res.end('{}');
});

// --- fake Masumi Payment Service -------------------------------------------
const escrow = { onChainState: null as string | null, resultHash: null as string | null, submitted: null as string | null, requestedFunds: null as unknown };
let researchPort = 0;
const mps = createServer(async (req, res) => {
	const json = await body(req);
	const reply = (data: unknown) => res.end(JSON.stringify({ status: 'success', data }));
	if (req.url?.startsWith('/api/v1/registry/agent-identifier')) {
		return reply({
			agentIdentifier: RESEARCH_AGENT,
			Metadata: {
				name: 'Freight Researcher', apiBaseUrl: `http://127.0.0.1:${researchPort}`,
				supportedPaymentSources: [{ network: 'Preprod', pricing: { pricingType: 'Fixed', Pricing: [{ amount: '500000', unit: 'usdm' }] } }],
			},
		});
	}
	if (req.url === '/api/v1/purchase') {
		research.purchased = true;
		research.purchaseAmounts = json.Amounts;
		return reply({});
	}
	if (req.url === '/api/v1/purchase/resolve-blockchain-identifier') {
		return reply({ onChainState: research.purchased ? 'ResultSubmitted' : 'FundsLocked', resultHash: research.purchased ? sha(`${research.nonce};${RESEARCH_ANSWER}`) : null });
	}
	if (req.url === '/api/v1/payment') {
		const now = Date.now();
		escrow.requestedFunds = json.RequestedFunds;
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

// --- fake Anthropic Messages API: research planning, call reports, synthesis ---
const model = createServer(async (req, res) => {
	const request = await body(req);
	const system = String(request.system ?? '');
	const report = system.includes('prepare a phone call')
		? { question: 'What does pallet freight usually cost, and what surcharges apply?' }
		: system.includes('combine several phone calls')
			? { summary: 'Compared two depots (mock).', artifacts: {}, humanFollowUp: null, caveats: [], objectiveMet: true }
			: { summary: 'Mock call reached the line; nothing real was established.', artifacts: {}, humanFollowUp: null, caveats: ['Mock telephony: no call was placed.'], objectiveMet: true };
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
	researchPort = await listen(researchAgent);
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
			DISPATCH_RESEARCH_AGENTS: RESEARCH_AGENT,
			MPS_BUY_KEY: 'smoke-buy',
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
		check(outcome.summary && Array.isArray(outcome.calls?.[0]?.outcome?.transcript?.turns), 'result is a structured outcome with the call transcript');

		console.log('buyer hires Dispatch to compare two depots, with a research budget');
		escrow.onChainState = null;
		escrow.resultHash = null;
		escrow.submitted = null;
		const nonce2 = 'beef00beef00be';
		const input2 = {
			to: '+15550100187', additional_numbers: '+15550100188', call_plan: 'compare', research_budget_usdm: '1',
			objective: 'Get a quote to move 3 pallets on Thursday.', authorization: 'Nothing: gather information only.',
		};
		const start2 = await (await fetch(`${base}/start_job`, { method: 'POST', body: JSON.stringify({ identifier_from_purchaser: nonce2, input_data: input2 }) })).json();
		check(start2.input_hash === sha(`${nonce2};${canonicalize(input2)}`), 'multi-call job accepted with a MIP-004 input hash');
		check(JSON.stringify(escrow.requestedFunds) === JSON.stringify([{ unit: 'usdm', amount: '2000000' }]), 'price = 1 tUSDM base + 1 tUSDM research budget');
		escrow.onChainState = 'FundsLocked';
		for (let i = 0; i < 120 && !escrow.submitted; i++) await sleep(250);
		check(research.purchased, 'Dispatch hired the research agent through the payment service');
		check(JSON.stringify(research.purchaseAmounts) === JSON.stringify([{ unit: 'usdm', amount: '500000' }]), 'research was bought at its fixed price, within budget');
		check(escrow.submitted, 'both calls placed and the result hash submitted');
		escrow.onChainState = 'ResultSubmitted';
		escrow.resultHash = escrow.submitted;
		let status2: { status: string; result?: string } = { status: 'running' };
		for (let i = 0; i < 40 && status2.status !== 'completed'; i++) {
			await sleep(250);
			status2 = await (await fetch(`${base}/status?job_id=${start2.id}`)).json();
		}
		const outcome2 = JSON.parse(status2.result ?? '{}');
		check(outcome2.calls?.length === 2 && outcome2.summary === 'Compared two depots (mock).', 'result compares both calls');
		check(outcome2.research?.agent === 'Freight Researcher' && outcome2.research.answer === RESEARCH_ANSWER, 'result includes the verified research');
		check(outcome2.spend?.spent === '500000' && outcome2.spend.budget === '1000000', 'result reports exactly what was spent from the budget');

		console.log('\nPASS: paid MIP-003 path works end to end, including research hiring and multi-call jobs');
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		console.error('\n--- agent-api logs ---\n' + logs);
		process.exitCode = 1;
	} finally {
		agent.kill('SIGTERM');
		mps.close();
		model.close();
		researchAgent.close();
	}
}

void main();
