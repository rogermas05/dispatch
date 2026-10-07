/**
 * Buyer-side clients: how Dispatch hires another Masumi agent.
 *
 *   RegistryClient   look an agent up by identifier (API URL, name, fixed price)
 *   RemoteAgent      the seller's MIP-003 API: /input_schema, /start_job, /status
 *   PurchaseClient   our payment service's buyer flow: /purchase and its state
 *
 * Field names follow the Masumi Payment Service source (routes/api/purchases,
 * routes/api/registry/agent-identifier) and MIP-003.
 */
import { isConfirmed, PaymentError } from '../payment.js';

const TIMEOUT_MS = 30_000;

type Fetch = typeof fetch;

export interface Price {
	unit: string;
	amount: string;
}

export interface AgentListing {
	agentIdentifier: string;
	name: string;
	apiBaseUrl: string;
	/** Fixed per-job price, or null when the agent prices dynamically and the cost cannot be bounded up front. */
	price: Price | null;
}

interface MpsEnvelope<T> {
	status?: string;
	data?: T;
	error?: unknown;
}

async function mpsRequest<T>(fetchImpl: Fetch, baseUrl: string, token: string, path: string, body?: unknown): Promise<T> {
	const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { 'Content-Type': 'application/json', token },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const json = (await res.json().catch(() => null)) as MpsEnvelope<T> | null;
	if (!res.ok || json?.status !== 'success' || json.data === undefined) {
		throw new PaymentError(`MPS ${path} failed: HTTP ${res.status} ${json?.error ? JSON.stringify(json.error).slice(0, 300) : ''}`.trim(), res.status);
	}
	return json.data;
}

interface PricingEntry {
	pricingType?: string;
	Pricing?: Array<{ amount?: string; unit?: string }>;
}

/** A single fixed price in one asset, or null if the listing cannot be bounded. */
export function fixedPrice(pricing: PricingEntry | null | undefined): Price | null {
	if (pricing?.pricingType !== 'Fixed' || pricing.Pricing?.length !== 1) return null;
	const [only] = pricing.Pricing;
	return only?.amount && /^\d+$/.test(only.amount) && typeof only.unit === 'string' ? { unit: only.unit, amount: only.amount } : null;
}

export class RegistryClient {
	constructor(private readonly cfg: { baseUrl: string; token: string; network: string; fetchImpl?: Fetch }) {}

	async lookup(agentIdentifier: string): Promise<AgentListing> {
		const data = await mpsRequest<{
			agentIdentifier: string;
			Metadata: {
				name: string;
				apiBaseUrl?: string | null;
				AgentPricing?: PricingEntry | null;
				supportedPaymentSources?: Array<{ network?: string; pricing?: PricingEntry }> | null;
			};
		}>(
			this.cfg.fetchImpl ?? fetch,
			this.cfg.baseUrl,
			this.cfg.token,
			`/registry/agent-identifier?agentIdentifier=${encodeURIComponent(agentIdentifier)}&network=${this.cfg.network}`,
		);
		const meta = data.Metadata;
		if (!meta.apiBaseUrl) throw new Error(`agent ${agentIdentifier} has no apiBaseUrl`);
		const source = meta.supportedPaymentSources?.find((s) => !s.network || s.network === this.cfg.network);
		return {
			agentIdentifier: data.agentIdentifier,
			name: meta.name,
			apiBaseUrl: meta.apiBaseUrl.replace(/\/$/, ''),
			price: fixedPrice(source?.pricing) ?? fixedPrice(meta.AgentPricing),
		};
	}
}

/** The escrow terms a seller's /start_job returns, which our purchase must reproduce exactly. */
export interface SellerTerms {
	id: string;
	blockchainIdentifier: string;
	payByTime: number | string;
	submitResultTime: number | string;
	unlockTime: number | string;
	externalDisputeUnlockTime: number | string;
	agentIdentifier: string;
	sellerVKey: string;
	input_hash: string;
	paymentSourceType?: string;
	supportedPaymentSourceIndex?: number;
}

export interface InputField {
	id: string;
	type: string;
	name?: string;
	validations?: Array<{ validation: string; value?: string }>;
}

export class RemoteAgent {
	constructor(
		private readonly baseUrl: string,
		private readonly fetchImpl: Fetch = fetch,
	) {}

	private async call<T>(path: string, body?: unknown): Promise<T> {
		const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!res.ok) throw new Error(`${this.baseUrl}${path} returned HTTP ${res.status}`);
		return (await res.json()) as T;
	}

	/** Flattened field list: input_data, or every group's input_data. */
	async inputFields(): Promise<InputField[]> {
		const schema = await this.call<{ input_data?: InputField[]; input_groups?: Array<{ input_data?: InputField[] }> }>('/input_schema');
		return schema.input_data ?? (schema.input_groups ?? []).flatMap((g) => g.input_data ?? []);
	}

	startJob(identifierFromPurchaser: string, inputData: Record<string, unknown>): Promise<SellerTerms> {
		return this.call<SellerTerms>('/start_job', { identifier_from_purchaser: identifierFromPurchaser, input_data: inputData });
	}

	status(jobId: string): Promise<{ status: string; result?: unknown }> {
		return this.call(`/status?job_id=${encodeURIComponent(jobId)}`);
	}
}

export interface PurchaseState {
	onChainState: string | null;
	resultHash: string | null;
	confirmed: boolean;
}

export class PurchaseClient {
	constructor(private readonly cfg: { baseUrl: string; token: string; network: string; fetchImpl?: Fetch }) {}

	private post<T>(path: string, body: unknown): Promise<T> {
		return mpsRequest<T>(this.cfg.fetchImpl ?? fetch, this.cfg.baseUrl, this.cfg.token, path, body);
	}

	/** Lock funds against the seller's terms. Amounts are passed explicitly so the payment service enforces our price. */
	async purchase(terms: SellerTerms, identifierFromPurchaser: string, amount: Price, metadata?: string): Promise<void> {
		await this.post('/purchase', {
			network: this.cfg.network,
			blockchainIdentifier: terms.blockchainIdentifier,
			agentIdentifier: terms.agentIdentifier,
			sellerVkey: terms.sellerVKey,
			inputHash: terms.input_hash,
			identifierFromPurchaser,
			payByTime: String(terms.payByTime),
			submitResultTime: String(terms.submitResultTime),
			unlockTime: String(terms.unlockTime),
			externalDisputeUnlockTime: String(terms.externalDisputeUnlockTime),
			Amounts: [amount],
			...(terms.paymentSourceType ? { paymentSourceType: terms.paymentSourceType } : {}),
			...(terms.supportedPaymentSourceIndex !== undefined ? { supportedPaymentSourceIndex: terms.supportedPaymentSourceIndex } : {}),
			...(metadata ? { metadata } : {}),
		});
	}

	async resolve(blockchainIdentifier: string): Promise<PurchaseState> {
		const p = await this.post<{
			onChainState?: string | null;
			resultHash?: string | null;
			CurrentTransaction?: { status?: string; newOnChainState?: string | null } | null;
			TransactionHistory?: Array<{ status?: string; newOnChainState?: string | null }> | null;
		}>('/purchase/resolve-blockchain-identifier', { network: this.cfg.network, blockchainIdentifier, includeHistory: 'true' });
		const onChainState = p.onChainState ?? null;
		return { onChainState, resultHash: p.resultHash ?? null, confirmed: onChainState !== null && isConfirmed(p, onChainState) };
	}
}
