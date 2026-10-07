import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { masumiInputHash, isValidPurchaserIdentifier } from './hash.js';
import { availability, type HealthDeps } from './health.js';
import { INPUT_SCHEMA, parseCallInput, type CallPolicy } from './input.js';
import type { EscrowTerms } from './payment.js';
import type { JobStore } from './store.js';
import { statusOf, type Job } from './types.js';

export { INPUT_SCHEMA } from './input.js';

/**
 * MIP-003 agent API.
 *
 * This is how other agents hire Dispatch: Sokosumi's `agents hire` and any
 * Masumi buyer call /input_schema, /start_job and /status here, and pay through
 * the payment service. The JobRunner executes the paid call; this file only
 * issues terms and reports state.
 *
 * Buyer routes are public by design — buyers do not hold our credentials. The
 * escrow is the access control: nothing is dialed until funds are locked.
 */

export interface ServerDeps extends HealthDeps {
	store: JobStore;
	policy: CallPolicy;
	/** Registers the job with the payment service and returns escrow terms. */
	createEscrow: (job: { inputHash: string; identifierFromPurchaser: string; jobId: string }) => Promise<EscrowTerms>;
	agentIdentifier: () => string | null;
	sellerVKey: () => string | null;
	/** Echoed to buyers so their purchase targets the same payment source. */
	paymentSource: () => { paymentSourceType: string; supportedPaymentSourceIndex?: number };
}

type Reply = { code: number; payload: unknown };

export class AgentApi {
	constructor(private readonly deps: ServerDeps) {}

	private startResponse(job: Job): Record<string, unknown> {
		return {
			id: job.id,
			status: statusOf(job.phase),
			blockchainIdentifier: job.blockchainIdentifier,
			payByTime: Number(job.payByTime),
			submitResultTime: Number(job.submitResultTime),
			unlockTime: Number(job.unlockTime),
			externalDisputeUnlockTime: Number(job.externalDisputeUnlockTime),
			agentIdentifier: this.deps.agentIdentifier(),
			sellerVKey: this.deps.sellerVKey(),
			identifierFromPurchaser: job.identifierFromPurchaser,
			input_hash: job.inputHash,
			...this.deps.paymentSource(),
		};
	}

	async startJob(body: Record<string, unknown>): Promise<Reply> {
		const identifier = body['identifier_from_purchaser'];
		if (!isValidPurchaserIdentifier(identifier)) {
			return { code: 400, payload: { error: 'identifier_from_purchaser must be 14-26 hex characters' } };
		}
		const inputData = body['input_data'];
		if (typeof inputData !== 'object' || inputData === null || Array.isArray(inputData)) {
			return { code: 400, payload: { error: 'input_data must be an object; see /input_schema' } };
		}
		const input = inputData as Record<string, unknown>;
		const inputHash = masumiInputHash(input, identifier);

		// A retried request with the same nonce gets the same terms, never a second escrow.
		const existing = this.deps.store.findByPurchaserIdentifier(identifier);
		if (existing) {
			return existing.inputHash === inputHash
				? { code: 200, payload: this.startResponse(existing) }
				: { code: 409, payload: { error: 'identifier_from_purchaser was already used with different input_data' } };
		}

		// Refuse before taking money, not after. Funds lock before work starts, so
		// accepting a job we cannot perform burns the buyer's escrow.
		const parsed = parseCallInput(input, this.deps.policy);
		if (!parsed.ok) return { code: 400, payload: { error: 'invalid input_data', details: parsed.errors } };
		const health = await availability(this.deps);
		if (health.status !== 'available') {
			return { code: 503, payload: { error: 'agent unavailable', reasons: health.reasons } };
		}

		const jobId = randomUUID();
		let terms: EscrowTerms;
		try {
			terms = await this.deps.createEscrow({ inputHash, identifierFromPurchaser: identifier, jobId });
		} catch (err) {
			return { code: 502, payload: { error: `payment service rejected the job: ${err instanceof Error ? err.message : err}` } };
		}

		const now = new Date().toISOString();
		const job = this.deps.store.put({
			id: jobId,
			phase: 'awaiting_payment',
			createdAt: now,
			updatedAt: now,
			identifierFromPurchaser: identifier,
			inputData: input,
			inputHash,
			...terms,
		});
		return { code: 200, payload: this.startResponse(job) };
	}

	status(jobId: string | null): Reply {
		if (!jobId) return { code: 400, payload: { error: 'job_id is required' } };
		const job = this.deps.store.get(jobId);
		if (!job) return { code: 404, payload: { error: 'unknown job_id' } };
		return {
			code: 200,
			payload: {
				id: job.id,
				job_id: job.id,
				status: statusOf(job.phase),
				// Released only once its hash is confirmed on-chain, so the buyer can
				// always verify what they received against the ledger.
				...(job.phase === 'completed' && job.result !== undefined ? { result: job.result, output_hash: job.outputHash } : {}),
				...(job.error ? { error: job.error } : {}),
			},
		};
	}

	/** Dispatch never pauses a job for more input; every field is collected at start_job. */
	provideInput(body: Record<string, unknown>): Reply {
		const jobId = body['job_id'];
		if (typeof jobId !== 'string') return { code: 400, payload: { error: 'job_id is required' } };
		const job = this.deps.store.get(jobId);
		if (!job) return { code: 404, payload: { error: 'unknown job_id' } };
		return { code: 409, payload: { error: `job is ${statusOf(job.phase)}; Dispatch does not request additional input` } };
	}

	/** Operator view for monitoring and the dashboard feed. Never exposes inputs or results. */
	jobs(): Reply {
		const summary = this.deps.store
			.list()
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map((j) => ({
				id: j.id,
				phase: j.phase,
				status: statusOf(j.phase),
				createdAt: j.createdAt,
				updatedAt: j.updatedAt,
				blockchainIdentifier: j.blockchainIdentifier,
				lastOnChainState: j.lastOnChainState ?? null,
				error: j.error ?? null,
			}));
		return { code: 200, payload: { jobs: summary } };
	}

	async availability() {
		return availability(this.deps);
	}
}

const MAX_BODY_BYTES = 64 * 1024;
const START_JOB_LIMIT_PER_MINUTE = 30;

class BodyTooLarge extends Error {}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
		chunks.push(chunk as Buffer);
	}
	if (chunks.length === 0) return {};
	const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SyntaxError('body must be a JSON object');
	return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, code: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
	res.end(body);
}

/** Fixed-window limit on start_job per client address; creating payment requests is not free for MPS. */
function rateLimiter(limit: number, windowMs = 60_000) {
	const windows = new Map<string, { start: number; count: number }>();
	return (key: string, now = Date.now()): boolean => {
		const w = windows.get(key);
		if (!w || now - w.start >= windowMs) {
			windows.set(key, { start: now, count: 1 });
			return true;
		}
		w.count += 1;
		return w.count <= limit;
	};
}

/**
 * @param operatorToken protects operator-only routes (/jobs). Buyer routes stay
 *   public: Masumi and Sokosumi buyers never hold our credentials.
 */
export function createAgentApiServer(api: AgentApi, operatorToken?: string) {
	const allowStart = rateLimiter(START_JOB_LIMIT_PER_MINUTE);
	return createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
		try {
			if (req.method === 'GET' && url.pathname === '/availability') return send(res, 200, await api.availability());
			if (req.method === 'GET' && url.pathname === '/input_schema') return send(res, 200, INPUT_SCHEMA);
			if (req.method === 'GET' && url.pathname === '/status') {
				const { code, payload } = api.status(url.searchParams.get('job_id'));
				return send(res, code, payload);
			}
			if (req.method === 'POST' && url.pathname === '/start_job') {
				const client = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0]!.trim();
				if (!allowStart(client)) return send(res, 429, { error: 'too many start_job requests; retry in a minute' });
				const { code, payload } = await api.startJob(await readJson(req));
				return send(res, code, payload);
			}
			if (req.method === 'POST' && url.pathname === '/provide_input') {
				const { code, payload } = api.provideInput(await readJson(req));
				return send(res, code, payload);
			}
			if (req.method === 'GET' && url.pathname === '/jobs' && operatorToken) {
				if (req.headers.authorization !== `Bearer ${operatorToken}`) return send(res, 401, { error: 'unauthorized' });
				const { code, payload } = api.jobs();
				return send(res, code, payload);
			}
			return send(res, 404, { error: 'not found' });
		} catch (err) {
			if (err instanceof BodyTooLarge) return send(res, 413, { error: `request body exceeds ${MAX_BODY_BYTES} bytes` });
			if (err instanceof SyntaxError) return send(res, 400, { error: `invalid JSON: ${err.message}` });
			console.error('[agent-api] request failed:', err);
			return send(res, 500, { error: 'internal error' });
		}
	});
}
