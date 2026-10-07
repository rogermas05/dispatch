import { randomBytes } from 'node:crypto';

/**
 * One-shot call endpoint, for agents that cannot drive an escrow themselves.
 *
 * The MIP-003 flow asks a buyer to start a job, lock funds in a Cardano
 * contract, and poll — which a Masumi-native agent does happily and ChatGPT
 * cannot do at all. This wraps the same flow behind two plain HTTP calls so a
 * GPT Action can use it, with Dispatch's own buyer wallet funding the escrow.
 *
 * The escrow is not skipped, only hidden. Every call still quotes, locks, logs
 * its input and output hashes on-chain and settles — the caller just does not
 * have to orchestrate it.
 */

export interface PublicCallDeps {
	/** Starts a job through the same path a MIP-003 buyer would use. */
	startJob: (body: Record<string, unknown>) => Promise<{ code: number; payload: unknown }>;
	status: (jobId: string | null) => { code: number; payload: unknown };
	paymentServiceUrl?: string;
	buyKey?: string;
}

export interface PublicCallRequest {
	to: string;
	objective: string;
	authorization?: string;
	on_behalf_of?: string;
	context?: string;
}

const toWhole = (atomic: string): string => String(Number(atomic) / 1e6);

export function validatePublicCall(body: Record<string, unknown>): { ok: true; req: PublicCallRequest } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

	const to = str(body.to);
	const objective = str(body.objective);
	if (!to) errors.push('to is required (E.164, e.g. +14155550123)');
	else if (!/^\+[1-9]\d{6,14}$/.test(to)) errors.push('to must be E.164, e.g. +14155550123');
	if (!objective) errors.push('objective is required — what the call must achieve');
	if (errors.length) return { ok: false, errors };

	return {
		ok: true,
		req: {
			to: to!,
			objective: objective!,
			// Default to information-only. An agent that forgets to say what may be
			// agreed to should get a call that commits its principal to nothing,
			// rather than one that improvises authority on their behalf.
			authorization: str(body.authorization) ?? 'Gather information only. Do not agree to anything, accept any offer, or make any commitment.',
			...(str(body.on_behalf_of) ? { on_behalf_of: str(body.on_behalf_of)! } : {}),
			...(str(body.context) ? { context: str(body.context)! } : {}),
		},
	};
}

/** Start a paid call and return immediately: calls take minutes, Actions time out. */
export async function beginPublicCall(req: PublicCallRequest, deps: PublicCallDeps): Promise<{ code: number; payload: unknown }> {
	if (!deps.paymentServiceUrl || !deps.buyKey) {
		return { code: 503, payload: { error: 'this endpoint needs PAYMENT_SERVICE_URL and MPS_BUY_KEY configured' } };
	}

	const identifierFromPurchaser = randomBytes(8).toString('hex');
	const started = await deps.startJob({
		identifier_from_purchaser: identifierFromPurchaser,
		input_data: {
			to: req.to,
			objective: req.objective,
			authorization: req.authorization,
			...(req.on_behalf_of ? { on_behalf_of: req.on_behalf_of } : {}),
			...(req.context ? { context: req.context } : {}),
		},
	});
	if (started.code !== 200) return started;

	const job = started.payload as Record<string, any>;
	const funds = (job.RequestedFunds ?? []) as Array<{ unit: string; amount: string }>;

	const res = await fetch(`${deps.paymentServiceUrl.replace(/\/$/, '')}/purchase/`, {
		method: 'POST',
		headers: { token: deps.buyKey, 'content-type': 'application/json' },
		body: JSON.stringify({
			blockchainIdentifier: job.blockchainIdentifier,
			network: 'Preprod',
			inputHash: job.input_hash,
			sellerVkey: job.sellerVKey,
			agentIdentifier: job.agentIdentifier,
			paymentSourceType: job.paymentSourceType,
			supportedPaymentSourceIndex: job.supportedPaymentSourceIndex,
			Amounts: funds,
			// Deadlines are signed into blockchainIdentifier — echo them verbatim.
			payByTime: String(job.payByTime),
			submitResultTime: String(job.submitResultTime),
			unlockTime: String(job.unlockTime),
			externalDisputeUnlockTime: String(job.externalDisputeUnlockTime),
			identifierFromPurchaser,
		}),
	});
	if (!res.ok) {
		return { code: 502, payload: { error: `could not lock funds: ${(await res.text()).slice(0, 200)}` } };
	}

	return {
		code: 202,
		payload: {
			call_id: job.id,
			status: 'paying',
			price_usdm: funds[0] ? toWhole(funds[0].amount) : null,
			message:
				'Payment is locking in Cardano escrow, then Dispatch dials. Calls take a few minutes — poll GET /v1/call/{call_id} and tell the user what it says.',
			poll_after_seconds: 45,
		},
	};
}

export function publicCallStatus(callId: string, deps: PublicCallDeps): { code: number; payload: unknown } {
	const { code, payload } = deps.status(callId);
	if (code !== 200) return { code, payload };
	const s = payload as Record<string, any>;

	const human: Record<string, string> = {
		awaiting_payment: 'Payment is still locking in escrow. Not dialed yet.',
		running: 'On the call now.',
		completed: 'Call finished.',
		failed: 'The call did not complete. No result hash was submitted, so the escrow refunds automatically — the caller is not charged.',
	};

	return {
		code: 200,
		payload: {
			call_id: callId,
			status: s.status,
			explanation: human[s.status as string] ?? 'In progress.',
			...(s.result !== undefined ? { result: s.result } : {}),
			...(s.output_hash ? { output_hash: s.output_hash } : {}),
			...(s.error ? { error: s.error } : {}),
			...(s.status === 'awaiting_payment' || s.status === 'running' ? { poll_after_seconds: 30 } : {}),
		},
	};
}
