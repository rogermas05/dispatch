import { randomBytes } from 'node:crypto';

/**
 * Hire Dispatch the way any buyer would: through its published MIP-003
 * endpoints, paying into Masumi escrow on Cardano.
 *
 * The texting front door deliberately does not call the telephony provider
 * directly. If it did, "my Sokosumi agent is calling, it costs X" would be a
 * sentence describing something that never happened — and the audit trail the
 * whole product rests on would not exist for the calls people actually make.
 *
 * The cost is a few minutes between agreeing and the phone ringing, while funds
 * lock on-chain. That wait is the protocol doing its job: the seller will not
 * dial until payment is secured, which is exactly the protection being sold.
 */

export interface PaidCallBrief {
	to: string;
	objective: string;
	authorization: string;
	context?: string;
}

export interface Progress {
	/** Price quoted by the agent, in whole tUSDM, once known. */
	onQuote?: (usdm: string) => Promise<void> | void;
	onFundsLocked?: () => Promise<void> | void;
}

export interface PaidCallResult {
	status: 'completed' | 'failed' | 'refunded';
	priceUsdm: string | null;
	jobId: string;
	result?: unknown;
	outputHash?: string;
	error?: string;
}

const POLL_MS = 10_000;
/** Funds must lock, the call must run, and the result must come back. */
const OVERALL_TIMEOUT_MS = 20 * 60_000;

function env(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is not set`);
	return v.replace(/\/$/, '');
}

async function json(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
	const res = await fetch(url, init);
	const text = await res.text();
	if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
	return JSON.parse(text) as Record<string, unknown>;
}

const toWhole = (atomic: string): string => {
	const n = Number(atomic) / 1e6;
	return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
};

export interface Quote {
	jobId: string;
	priceUsdm: string | null;
	/** Everything the purchase call needs, carried verbatim. */
	terms: Record<string, unknown>;
	identifierFromPurchaser: string;
	/** Unix ms. After this the quote expires unfunded and the job dies. */
	payByTime: number;
}

/**
 * Quote a job without paying for it.
 *
 * Creating the job and funding it are separate on purpose: the escrow gives the
 * buyer until payByTime to decide, so a person can see the price and say no. A
 * quote they never accept simply expires — nothing is locked, nothing is spent.
 */
export async function quoteCall(brief: PaidCallBrief): Promise<Quote> {
	const api = env('AGENT_API_PUBLIC_URL');
	const identifierFromPurchaser = randomBytes(8).toString('hex');
	const job = (await json(`${api}/start_job`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			identifier_from_purchaser: identifierFromPurchaser,
			input_data: {
				to: brief.to,
				objective: brief.objective,
				authorization: brief.authorization,
				...(brief.context ? { context: brief.context } : {}),
			},
		}),
	})) as Record<string, any>;

	const funds = (job.RequestedFunds ?? []) as Array<{ unit: string; amount: string }>;
	return {
		jobId: String(job.id),
		priceUsdm: funds[0] ? toWhole(funds[0].amount) : null,
		terms: job,
		identifierFromPurchaser,
		payByTime: Number(job.payByTime),
	};
}

/** Accept a quote: lock the funds, then wait for the call to finish. */
export async function payAndRun(quote: Quote, progress: Progress = {}): Promise<PaidCallResult> {
	const api = env('AGENT_API_PUBLIC_URL');
	const mps = env('PAYMENT_SERVICE_URL');
	const buyKey = env('MPS_BUY_KEY');
	const job = quote.terms as Record<string, any>;
	const funds = (job.RequestedFunds ?? []) as Array<{ unit: string; amount: string }>;
	const priceUsdm = quote.priceUsdm;
	const identifierFromPurchaser = quote.identifierFromPurchaser;

	if (Date.now() > quote.payByTime) {
		return { status: 'failed', priceUsdm, jobId: quote.jobId, error: 'the quote expired before it was accepted' };
	}
	// Funds lock before any work starts. Deadlines are signed into
	// blockchainIdentifier, so they are echoed back exactly as issued.
	await json(`${mps}/purchase/`, {
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
			Amounts: funds,
			payByTime: String(job.payByTime),
			submitResultTime: String(job.submitResultTime),
			unlockTime: String(job.unlockTime),
			externalDisputeUnlockTime: String(job.externalDisputeUnlockTime),
			identifierFromPurchaser,
		}),
	});

	const deadline = Date.now() + OVERALL_TIMEOUT_MS;
	let announcedLocked = false;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, POLL_MS));
		const s = (await json(`${api}/status?job_id=${job.id}`).catch(() => ({}))) as Record<string, any>;

		if (!announcedLocked && s.status && s.status !== 'awaiting_payment') {
			announcedLocked = true;
			await progress.onFundsLocked?.();
		}
		if (s.status === 'completed') {
			return { status: 'completed', priceUsdm, jobId: String(job.id), result: s.result, outputHash: s.output_hash };
		}
		if (s.status === 'failed') {
			// The seller never submits a result, so escrow refunds the buyer when
			// submitResultTime passes. Nobody is charged for a call that failed.
			return { status: 'failed', priceUsdm, jobId: String(job.id), error: String(s.error ?? 'the job failed') };
		}
	}
	return { status: 'failed', priceUsdm, jobId: String(job.id), error: 'timed out waiting for the job to finish' };
}
