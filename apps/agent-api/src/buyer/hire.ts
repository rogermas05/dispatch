import { randomBytes } from 'node:crypto';
import { masumiInputHash, masumiOutputHash } from '../hash.js';
import type { AgentListing, InputField, Price, PurchaseState, SellerTerms } from './clients.js';

/**
 * Hiring one Masumi agent, as a persisted state machine.
 *
 * Spending someone else's money, so the rules are strict:
 * - only agents with a fixed price in our asset that fits the remaining budget;
 * - the seller's input hash must equal our own MIP-004 hash, or we do not pay;
 * - every external step is persisted before it is taken, and an uncertain
 *   purchase is never repeated;
 * - the result is used only if sha256(nonce;result) equals the result hash the
 *   seller committed on-chain.
 */

export type HireStage = 'quoting' | 'terms_received' | 'purchase_sent' | 'done' | 'failed';

export interface HireState {
	stage: HireStage;
	agentIdentifier: string;
	agentName?: string;
	nonce: string;
	input?: Record<string, unknown>;
	price?: Price;
	terms?: SellerTerms;
	result?: string;
	error?: string;
	/** Set once the purchase may have reached the payment service: the price counts as spent from then on. */
	purchaseSent?: boolean;
}

export interface HireDeps {
	lookup(agentIdentifier: string): Promise<AgentListing>;
	remote(baseUrl: string): {
		inputFields(): Promise<InputField[]>;
		startJob(nonce: string, input: Record<string, unknown>): Promise<SellerTerms>;
		status(jobId: string): Promise<{ status: string; result?: unknown }>;
	};
	purchase(terms: SellerTerms, nonce: string, amount: Price, metadata?: string): Promise<void>;
	resolvePurchase(blockchainIdentifier: string): Promise<PurchaseState>;
	/** Persist hire progress before each external step. */
	save(state: HireState): void;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	pollMs?: number;
}

export interface HireRequest {
	agentIdentifier: string;
	/** Free-text request, placed into the agent's best-matching text field. */
	request: string;
	/** Atomic units the hire may cost, in `unit`. */
	budget: bigint;
	unit: string;
	/** Unix ms by which we need the result; afterwards we stop waiting. */
	deadline: number;
	metadata?: string;
}

const TEXT_TYPES = new Set(['text', 'textarea', 'string']);
const PREFERRED_FIELD = /prompt|query|question|topic|request|task|text|input|description|brief/i;

const isOptional = (f: InputField) => (f.validations ?? []).some((v) => v.validation === 'optional' && v.value !== 'false');

/**
 * Put a free-text request into the seller's schema, or return null when the
 * schema needs anything we cannot honestly fill (extra required fields).
 */
export function mapRequestToInput(fields: InputField[], request: string): Record<string, unknown> | null {
	const fillable = fields.filter((f) => f.type !== 'none');
	const required = fillable.filter((f) => !isOptional(f));
	const textFields = fillable.filter((f) => TEXT_TYPES.has(f.type));
	const target =
		textFields.find((f) => PREFERRED_FIELD.test(f.id) || PREFERRED_FIELD.test(f.name ?? '')) ??
		(textFields.length === 1 ? textFields[0] : undefined);
	if (!target) return null;
	if (required.some((f) => f.id !== target.id)) return null;
	return { [target.id]: request };
}

export function newNonce(): string {
	return randomBytes(10).toString('hex');
}

function fail(state: HireState, deps: HireDeps, error: string): HireState {
	const next: HireState = { ...state, stage: 'failed', error };
	deps.save(next);
	return next;
}

/** Advance a hire to completion or failure. Resumable from any persisted stage. */
export async function runHire(req: HireRequest, initial: HireState | undefined, deps: HireDeps): Promise<HireState> {
	const now = deps.now ?? Date.now;
	const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	let state: HireState = initial ?? { stage: 'quoting', agentIdentifier: req.agentIdentifier, nonce: newNonce() };
	if (state.stage === 'done' || state.stage === 'failed') return state;

	let listing: AgentListing;
	try {
		listing = await deps.lookup(req.agentIdentifier);
	} catch (err) {
		return fail(state, deps, `registry lookup failed: ${err instanceof Error ? err.message : err}`);
	}
	const remote = deps.remote(listing.apiBaseUrl);

	if (state.stage === 'quoting') {
		const price = listing.price;
		if (!price || price.unit !== req.unit) return fail(state, deps, `${listing.name} has no fixed price in the budget asset`);
		if (BigInt(price.amount) > req.budget) return fail(state, deps, `${listing.name} costs ${price.amount}, over the ${req.budget} budget`);

		let input: Record<string, unknown> | null;
		try {
			input = mapRequestToInput(await remote.inputFields(), req.request);
		} catch (err) {
			return fail(state, deps, `could not read ${listing.name}'s input schema: ${err instanceof Error ? err.message : err}`);
		}
		if (!input) return fail(state, deps, `${listing.name}'s input schema needs fields Dispatch cannot fill`);

		state = { ...state, agentName: listing.name, input, price };
		deps.save(state);
		let terms: SellerTerms;
		try {
			terms = await remote.startJob(state.nonce, input);
		} catch (err) {
			return fail(state, deps, `start_job failed: ${err instanceof Error ? err.message : err}`);
		}
		if (terms.input_hash !== masumiInputHash(input, state.nonce)) {
			return fail(state, deps, 'seller input hash does not match MIP-004; not paying for a commitment we cannot verify');
		}
		if (terms.agentIdentifier !== req.agentIdentifier) return fail(state, deps, 'seller terms name a different agent');
		if (Number(terms.payByTime) <= now()) return fail(state, deps, 'seller terms already expired');
		state = { ...state, stage: 'terms_received', terms };
		deps.save(state);
	}

	if (state.stage === 'terms_received') {
		// Persist the intent first: if we crash after this line, we must assume the
		// purchase may have gone through and never send it again.
		state = { ...state, stage: 'purchase_sent', purchaseSent: true };
		deps.save(state);
		try {
			await deps.purchase(state.terms!, state.nonce, state.price!, req.metadata);
		} catch (err) {
			return fail(state, deps, `purchase failed: ${err instanceof Error ? err.message : err}`);
		}
	}

	// purchase_sent: wait for the seller's result and its on-chain commitment.
	const pollMs = deps.pollMs ?? 10_000;
	while (now() < req.deadline) {
		const status = await remote.status(state.terms!.id).catch(() => null);
		if (status?.status === 'failed') return fail(state, deps, `${state.agentName} reported the job failed`);
		if (status?.status === 'completed' && typeof status.result === 'string') {
			const expected = masumiOutputHash(status.result, state.nonce);
			const onChain = await deps.resolvePurchase(state.terms!.blockchainIdentifier).catch(() => null);
			if (onChain?.resultHash === expected) {
				state = { ...state, stage: 'done', result: status.result };
				deps.save(state);
				return state;
			}
			if (onChain?.resultHash && onChain.resultHash !== expected) {
				return fail(state, deps, 'delivered result does not match the hash committed on-chain');
			}
		}
		await sleep(pollMs);
	}
	return fail(state, deps, 'no verified result before the deadline');
}
