#!/usr/bin/env node
/**
 * Checkpoint 4 — hire Dispatch and pay for it on-chain, as a buyer would.
 *
 *   node scripts/buy-job.mjs start    start a job and lock funds in escrow
 *   node scripts/buy-job.mjs watch    follow the job and the escrow until collection
 *
 * This is the buyer half, which nothing else in the repo exercises. It drives
 * the published MIP-003 endpoints and the payment service's purchase API, so it
 * is a genuine outside-in test rather than the agent calling itself.
 *
 * Reads AGENT_API_PUBLIC_URL, PAYMENT_SERVICE_URL, MPS_BUY_KEY from the
 * environment. State goes to .local/paid-job.json (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const STATE = '.local/paid-job.json';

function env(name) {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is not set`);
	return v.replace(/\/$/, '');
}
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const save = (s) => { mkdirSync('.local', { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2)); };

async function json(url, init = {}) {
	const res = await fetch(url, init);
	const text = await res.text();
	let body;
	try { body = JSON.parse(text); } catch { body = text; }
	if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} -> ${res.status}: ${text.slice(0, 400)}`);
	return body;
}

async function start() {
	const api = env('AGENT_API_PUBLIC_URL');
	const mps = env('PAYMENT_SERVICE_URL');
	const buyKey = env('MPS_BUY_KEY');
	const state = load();
	if (state.jobId) throw new Error(`a job is already in flight (${state.jobId}); inspect ${STATE} before starting another`);

	// 14–26 hex characters, per MIP-003.
	const identifierFromPurchaser = randomBytes(8).toString('hex');
	const input_data = {
		to: process.env.DISPATCH_TEST_NUMBER ?? '+16307708220',
		objective:
			'This is a paid end-to-end test of the Dispatch agent. Greet the person, say you are Dispatch calling to confirm a paid test booking, ask them to say a word or two so the transcript records something, thank them and end the call politely.',
		authorization:
			'You may identify yourself and conduct this short confirmation only. You may not agree to anything, accept any offer, or make any commitment.',
		max_duration_seconds: 120,
	};

	console.log('→ POST /start_job');
	const job = await json(`${api}/start_job`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ identifier_from_purchaser: identifierFromPurchaser, input_data }),
	});
	console.log(`  job ${job.id}`);
	console.log(`  blockchainIdentifier ${String(job.blockchainIdentifier).slice(0, 40)}…`);
	console.log(`  input_hash ${job.input_hash}`);
	console.log(`  submitResultTime ${job.submitResultTime}  unlockTime ${job.unlockTime}`);

	// Funds lock BEFORE work starts: this is the green light to dial, not a
	// holding pen after delivery.
	console.log('→ locking funds in escrow');
	const purchase = await json(`${mps}/purchase/`, {
		method: 'POST',
		headers: { token: buyKey, 'content-type': 'application/json' },
		body: JSON.stringify({
			blockchainIdentifier: job.blockchainIdentifier,
			network: 'Preprod',
			inputHash: job.input_hash,
			sellerVkey: job.sellerVKey,
			agentIdentifier: job.agentIdentifier,
			paymentSourceType: job.paymentSourceType,
			supportedPaymentSourceIndex: job.supportedPaymentSourceIndex,
			Amounts: job.RequestedFunds ?? [{ unit: process.env.USDM_UNIT ?? '', amount: process.env.TASK_PRICE_ATOMIC ?? '1000000' }],
			// Pass the deadlines back exactly as issued. They are already unix
			// milliseconds, and they are signed into blockchainIdentifier — any
			// reformatting here fails with "signature invalid".
			payByTime: String(job.payByTime),
			submitResultTime: String(job.submitResultTime),
			unlockTime: String(job.unlockTime),
			externalDisputeUnlockTime: String(job.externalDisputeUnlockTime),
			identifierFromPurchaser,
		}),
	});
	const pid = purchase?.data?.id ?? purchase?.id;
	console.log(`  purchase ${pid}`);

	save({
		jobId: job.id,
		identifierFromPurchaser,
		blockchainIdentifier: job.blockchainIdentifier,
		inputHash: job.input_hash,
		purchaseId: pid,
		deadlines: {
			payByTime: job.payByTime,
			submitResultTime: job.submitResultTime,
			unlockTime: job.unlockTime,
			externalDisputeUnlockTime: job.externalDisputeUnlockTime,
		},
		startedAt: new Date().toISOString(),
	});
	console.log(`\nsaved to ${STATE}. Now: node scripts/buy-job.mjs watch`);
}

async function watch() {
	const api = env('AGENT_API_PUBLIC_URL');
	const mps = env('PAYMENT_SERVICE_URL');
	const buyKey = env('MPS_BUY_KEY');
	const state = load();
	if (!state.jobId) throw new Error('no job in flight; run start first');

	let lastJob = '', lastChain = '';
	for (let i = 0; i < 400; i++) {
		const status = await json(`${api}/status?job_id=${state.jobId}`).catch((e) => ({ status: `error: ${e.message.slice(0, 80)}` }));
		const purchases = await json(`${mps}/purchase/?network=Preprod&limit=10`, { headers: { token: buyKey } }).catch(() => null);
		const mine = (purchases?.data?.Purchases ?? purchases?.data ?? []).find(
			(p) => p.blockchainIdentifier === state.blockchainIdentifier,
		);
		const chain = mine?.onChainState ?? mine?.NextAction?.requestedAction ?? 'unknown';

		if (status.status !== lastJob || chain !== lastChain) {
			console.log(`${new Date().toISOString()}  job=${status.status}  chain=${chain}`);
			lastJob = status.status; lastChain = chain;
		}
		if (chain === 'Withdrawn' || chain === 'FundsOrDatumInvalid') break;
		if (status.status === 'completed' && (chain === 'ResultSubmitted' || chain === 'Withdrawn')) {
			// Keep watching: collection happens after unlockTime, not now.
		}
		await new Promise((r) => setTimeout(r, 15_000));
	}
	console.log(`\nunlockTime is ${state.deadlines.unlockTime}. Collection happens after it; the node must stay up until then.`);
	console.log('Then verify independently: npm run verify:receipt');
}

const cmd = process.argv[2];
if (cmd === 'start') await start();
else if (cmd === 'watch') await watch();
else { console.error('usage: buy-job.mjs start|watch'); process.exit(1); }
