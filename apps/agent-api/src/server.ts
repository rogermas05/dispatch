import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { sha256Hex, isValidPurchaserIdentifier } from './hash.js';
import { availability, type HealthDeps } from './health.js';
import type { Job, JobStatus } from './types.js';

/**
 * MIP-003 agent API.
 *
 * This is the server half of the integration: buyers push jobs at us here, while
 * the Sokosumi worker pulls tasks on the other side. Both exist because they do
 * different things — the worker executes, this endpoint plus the payment service
 * settle.
 *
 * Deliberately stores jobs in memory. Durable job state belongs in the payment
 * service's database, which already owns the escrow lifecycle; a second
 * persistence layer here would be a second source of truth about who was paid.
 */

export interface ServerDeps extends HealthDeps {
	/** Registers the job with the payment service and returns escrow terms. */
	createEscrow: (job: { inputHash: string; identifierFromPurchaser: string }) => Promise<{
		blockchainIdentifier: string;
		payByTime: string;
		submitResultTime: string;
		unlockTime: string;
		externalDisputeUnlockTime: string;
	}>;
	agentIdentifier: () => string | null;
	sellerVKey: () => string | null;
}

/** The input Dispatch accepts. MIP-003 allows input_data or input_groups, never both. */
export const INPUT_SCHEMA = {
	input_data: [
		{ id: 'to', type: 'string', name: 'Phone number', data: { description: 'Number to call, E.164 (e.g. +14155550123)' } },
		{ id: 'objective', type: 'string', name: 'Objective', data: { description: 'What this call must achieve' } },
		{ id: 'authorization', type: 'string', name: 'Authorization', data: { description: 'What the agent may agree to on your behalf. Anything outside this is escalated, not improvised. This text is hashed on-chain.' } },
		{ id: 'context', type: 'string', name: 'Context', data: { description: 'Optional facts the agent may need: account numbers, names, dates' } },
		{ id: 'max_duration_seconds', type: 'number', name: 'Maximum duration', data: { description: 'Call length ceiling in seconds. Default 900.' } },
	],
} as const;

export class AgentApi {
	private readonly jobs = new Map<string, Job>();

	constructor(private readonly deps: ServerDeps) {}

	getJob(id: string): Job | undefined {
		return this.jobs.get(id);
	}

	setStatus(id: string, status: JobStatus, patch: Partial<Job> = {}): void {
		const job = this.jobs.get(id);
		if (!job) throw new Error(`unknown job ${id}`);
		this.jobs.set(id, { ...job, ...patch, status });
	}

	async startJob(body: Record<string, unknown>): Promise<{ code: number; payload: unknown }> {
		const identifier = body['identifier_from_purchaser'];
		if (!isValidPurchaserIdentifier(identifier)) {
			return { code: 400, payload: { error: 'identifier_from_purchaser must be 14-26 hex characters' } };
		}
		const inputData = body['input_data'];
		if (typeof inputData !== 'object' || inputData === null) {
			return { code: 400, payload: { error: 'input_data must be an object' } };
		}

		// Refuse before taking money, not after. Funds lock before work starts, so
		// accepting a job we cannot perform burns the buyer's escrow.
		const health = await availability(this.deps);
		if (health.status !== 'available') {
			return { code: 503, payload: { error: 'agent unavailable', reasons: health.reasons } };
		}

		const inputHash = sha256Hex(inputData);
		let escrow: Awaited<ReturnType<ServerDeps['createEscrow']>>;
		try {
			escrow = await this.deps.createEscrow({ inputHash, identifierFromPurchaser: identifier });
		} catch (err) {
			return { code: 502, payload: { error: `payment service rejected the job: ${err instanceof Error ? err.message : err}` } };
		}

		const job: Job = {
			id: randomUUID(),
			status: 'awaiting_payment',
			createdAt: new Date().toISOString(),
			identifierFromPurchaser: identifier,
			inputData: inputData as Record<string, unknown>,
			inputHash,
			blockchainIdentifier: escrow.blockchainIdentifier,
			payByTime: escrow.payByTime,
			submitResultTime: escrow.submitResultTime,
			unlockTime: escrow.unlockTime,
			externalDisputeUnlockTime: escrow.externalDisputeUnlockTime,
		};
		this.jobs.set(job.id, job);

		return {
			code: 200,
			payload: {
				id: job.id,
				blockchainIdentifier: job.blockchainIdentifier,
				payByTime: job.payByTime,
				submitResultTime: job.submitResultTime,
				unlockTime: job.unlockTime,
				externalDisputeUnlockTime: job.externalDisputeUnlockTime,
				agentIdentifier: this.deps.agentIdentifier(),
				sellerVKey: this.deps.sellerVKey(),
				identifierFromPurchaser: job.identifierFromPurchaser,
				input_hash: job.inputHash,
			},
		};
	}

	status(jobId: string | null): { code: number; payload: unknown } {
		if (!jobId) return { code: 400, payload: { error: 'job_id is required' } };
		const job = this.jobs.get(jobId);
		if (!job) return { code: 404, payload: { error: 'unknown job_id' } };
		return {
			code: 200,
			payload: {
				job_id: job.id,
				status: job.status,
				...(job.result !== undefined ? { result: job.result } : {}),
				...(job.outputHash ? { output_hash: job.outputHash } : {}),
				...(job.error ? { error: job.error } : {}),
			},
		};
	}

	provideInput(body: Record<string, unknown>): { code: number; payload: unknown } {
		const jobId = body['job_id'];
		if (typeof jobId !== 'string') return { code: 400, payload: { error: 'job_id is required' } };
		const job = this.jobs.get(jobId);
		if (!job) return { code: 404, payload: { error: 'unknown job_id' } };
		if (job.status !== 'awaiting_input') {
			return { code: 409, payload: { error: `job is ${job.status}, not awaiting_input` } };
		}
		const extra = body['input_data'];
		if (typeof extra !== 'object' || extra === null) {
			return { code: 400, payload: { error: 'input_data must be an object' } };
		}
		this.jobs.set(jobId, {
			...job,
			status: 'running',
			inputData: { ...job.inputData, ...(extra as Record<string, unknown>) },
		});
		return { code: 200, payload: { job_id: jobId, status: 'running' } };
	}

	async availability() {
		return availability(this.deps);
	}
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function send(res: ServerResponse, code: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
	res.end(body);
}

export function createAgentApiServer(api: AgentApi, token?: string) {
	return createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

		// /availability stays open so buyers can see us before paying; everything
		// else is gated once a token is configured (Phase 5 deployment).
		if (token && url.pathname !== '/availability') {
			if (req.headers.authorization !== `Bearer ${token}`) {
				return send(res, 401, { error: 'unauthorized' });
			}
		}

		try {
			if (req.method === 'GET' && url.pathname === '/availability') {
				return send(res, 200, await api.availability());
			}
			if (req.method === 'GET' && url.pathname === '/input_schema') {
				return send(res, 200, INPUT_SCHEMA);
			}
			if (req.method === 'GET' && url.pathname === '/status') {
				const { code, payload } = api.status(url.searchParams.get('job_id'));
				return send(res, code, payload);
			}
			if (req.method === 'POST' && url.pathname === '/start_job') {
				const { code, payload } = await api.startJob(await readJson(req));
				return send(res, code, payload);
			}
			if (req.method === 'POST' && url.pathname === '/provide_input') {
				const { code, payload } = api.provideInput(await readJson(req));
				return send(res, code, payload);
			}
			return send(res, 404, { error: 'not found' });
		} catch (err) {
			return send(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
		}
	});
}
