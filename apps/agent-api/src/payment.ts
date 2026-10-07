/**
 * Seller-side client for the Masumi Payment Service (MPS).
 *
 * Three calls carry the whole escrow lifecycle on our side:
 *   POST /payment                              create the payment request (escrow terms)
 *   POST /payment/resolve-blockchain-identifier read on-chain state
 *   POST /payment/submit-result                 commit the result hash
 * Collection after unlockTime is performed by MPS itself; nothing here triggers it.
 *
 * Field names follow the MPS source (src/routes/api/payments) and the TOKEN2049
 * reference agent, which ran the same calls against a live node. Responses are
 * wrapped as { status: 'success', data }.
 */

export type Network = 'Preprod' | 'Mainnet';

export interface PaymentConfig {
	baseUrl: string;
	/** MPS API key, sent as the `token` header. Use a scoped pay key, not the admin key. */
	token: string;
	network: Network;
	agentIdentifier: string;
	paymentSourceType: 'Web3CardanoV1' | 'Web3CardanoV2';
	/** Required for V2 sources; the index of our pricing in supported_payment_sources. */
	supportedPaymentSourceIndex?: number;
	/** Price per call. Null for Fixed pricing, where the registry entry carries the amount. */
	price: { unit: string; amount: string } | null;
	/** Escrow windows in minutes from job start. */
	windows: { payBy: number; submitResult: number; unlock: number; externalDispute: number };
	fetchImpl?: typeof fetch;
	now?: () => number;
}

/** Escrow terms as MPS returns them: Unix milliseconds, as strings. */
export interface EscrowTerms {
	blockchainIdentifier: string;
	/**
	 * What the buyer must lock. Without this a buyer cannot know what to pay:
	 * pricing is registered as Dynamic on-chain, so the amount is quoted per job
	 * and exists nowhere else.
	 */
	requestedFunds?: Array<{ unit: string; amount: string }>;
	payByTime: string;
	submitResultTime: string;
	unlockTime: string;
	externalDisputeUnlockTime: string;
}

export interface PaymentState {
	onChainState: string | null;
	resultHash: string | null;
	nextAction: string | null;
	errorNote: string | null;
	/** Whether `onChainState` is backed by a Confirmed transaction, not only reported. */
	confirmed: boolean;
}

interface MpsTransaction {
	status?: string;
	newOnChainState?: string | null;
}

interface MpsPayment extends Partial<EscrowTerms> {
	onChainState?: string | null;
	resultHash?: string | null;
	NextAction?: { requestedAction?: string; errorNote?: string | null };
	CurrentTransaction?: MpsTransaction | null;
	TransactionHistory?: MpsTransaction[] | null;
}

const MINUTE = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class PaymentError extends Error {
	constructor(message: string, readonly status: number | null) {
		super(message);
		this.name = 'PaymentError';
	}
}

/** A state counts only once a Confirmed transaction moved the payment into it. */
export function isConfirmed(payment: MpsPayment, state: string): boolean {
	const confirmedInto = (tx: MpsTransaction | null | undefined) => tx?.status === 'Confirmed' && tx.newOnChainState === state;
	return confirmedInto(payment.CurrentTransaction) || (payment.TransactionHistory ?? []).some(confirmedInto);
}

export class PaymentServiceClient {
	private readonly fetch: typeof fetch;
	private readonly now: () => number;

	constructor(private readonly cfg: PaymentConfig) {
		this.fetch = cfg.fetchImpl ?? fetch;
		this.now = cfg.now ?? Date.now;
		if (cfg.paymentSourceType === 'Web3CardanoV2' && !Number.isInteger(cfg.supportedPaymentSourceIndex)) {
			throw new Error('Web3CardanoV2 payments require supportedPaymentSourceIndex');
		}
	}

	private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
		const res = await this.fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}${path}`, {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: { 'Content-Type': 'application/json', token: this.cfg.token },
			body: JSON.stringify(body),
		});
		const json = (await res.json().catch(() => null)) as { status?: string; data?: T; error?: unknown } | null;
		if (!res.ok || json?.status !== 'success' || json.data === undefined) {
			const detail = json?.error ? JSON.stringify(json.error).slice(0, 300) : '';
			throw new PaymentError(`MPS ${path} failed: HTTP ${res.status} ${detail}`.trim(), res.status);
		}
		return json.data;
	}

	/**
	 * Create the payment request whose terms the buyer locks funds against.
	 * `price` and `windows` override the defaults for jobs that cost or take more
	 * (research budgets, several calls).
	 */
	async createPayment(
		job: { inputHash: string; identifierFromPurchaser: string; metadata?: string },
		overrides: { price?: { unit: string; amount: string }; windows?: PaymentConfig['windows'] } = {},
	): Promise<EscrowTerms> {
		const start = this.now();
		const at = (minutes: number) => new Date(start + minutes * MINUTE).toISOString();
		const windows = overrides.windows ?? this.cfg.windows;
		const price = overrides.price ?? this.cfg.price;
		const payment = await this.post<MpsPayment>('/payment', {
			network: this.cfg.network,
			agentIdentifier: this.cfg.agentIdentifier,
			paymentSourceType: this.cfg.paymentSourceType,
			...(this.cfg.paymentSourceType === 'Web3CardanoV2' ? { supportedPaymentSourceIndex: this.cfg.supportedPaymentSourceIndex } : {}),
			inputHash: job.inputHash,
			identifierFromPurchaser: job.identifierFromPurchaser,
			...(price ? { RequestedFunds: [price] } : {}),
			payByTime: at(windows.payBy),
			submitResultTime: at(windows.submitResult),
			unlockTime: at(windows.unlock),
			externalDisputeUnlockTime: at(windows.externalDispute),
			...(job.metadata ? { metadata: job.metadata } : {}),
		});
		const terms = {
			blockchainIdentifier: payment.blockchainIdentifier,
			payByTime: payment.payByTime,
			submitResultTime: payment.submitResultTime,
			unlockTime: payment.unlockTime,
			externalDisputeUnlockTime: payment.externalDisputeUnlockTime,
		};
		const missing = Object.entries(terms).filter(([, v]) => typeof v !== 'string' || !v).map(([k]) => k);
		if (missing.length) throw new PaymentError(`MPS /payment response is missing ${missing.join(', ')}`, null);
		return terms as EscrowTerms;
	}

	async resolve(blockchainIdentifier: string): Promise<PaymentState> {
		const payment = await this.post<MpsPayment>('/payment/resolve-blockchain-identifier', {
			network: this.cfg.network,
			blockchainIdentifier,
			includeHistory: 'true',
		});
		const onChainState = payment.onChainState ?? null;
		return {
			onChainState,
			resultHash: payment.resultHash ?? null,
			nextAction: payment.NextAction?.requestedAction ?? null,
			errorNote: payment.NextAction?.errorNote ?? null,
			confirmed: onChainState !== null && isConfirmed(payment, onChainState),
		};
	}

	async submitResult(blockchainIdentifier: string, resultHash: string): Promise<void> {
		await this.post('/payment/submit-result', {
			network: this.cfg.network,
			blockchainIdentifier,
			submitResultHash: resultHash,
		});
	}
}

/**
 * Stretch the escrow windows so a job's work fits before submitResultTime:
 * pay-by, then research, then every call at its maximum length, then a margin.
 * Later windows move by the same amount so the dispute period is unchanged.
 */
export function windowsForJob(
	base: PaymentConfig['windows'],
	job: { calls: number; maxDurationSeconds: number; researchMinutes: number },
	marginMinutes = 10,
): PaymentConfig['windows'] {
	const needed = base.payBy + job.researchMinutes + job.calls * Math.ceil(job.maxDurationSeconds / 60) + marginMinutes;
	const shift = Math.max(0, needed - base.submitResult);
	return {
		payBy: base.payBy,
		submitResult: base.submitResult + shift,
		unlock: base.unlock + shift,
		externalDispute: base.externalDispute + shift,
	};
}
