import { join } from 'node:path';
import { parseAllowlist, type CallPolicy } from './input.js';
import type { PaymentConfig } from './payment.js';

/**
 * Environment → typed config, validated once at startup so a bad deploy fails
 * loudly instead of failing a buyer's paid job later.
 */

const USDM_DECIMALS = 6;

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
	return n;
}

/** "1" or "0.5" tUSDM → atomic units as a string. */
export function toAtomic(decimal: string, decimals = USDM_DECIMALS): string {
	if (!/^\d+(\.\d+)?$/.test(decimal)) throw new Error(`price "${decimal}" is not a positive decimal`);
	const [whole, fraction = ''] = decimal.split('.');
	if (fraction.length > decimals) throw new Error(`price "${decimal}" has more than ${decimals} decimals`);
	const atomic = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
	if (atomic <= 0n) throw new Error('price must be greater than zero');
	return atomic.toString();
}

export interface AgentApiConfig {
	port: number;
	jobsDir: string;
	operatorToken: string | undefined;
	policy: CallPolicy;
	/** Null while the payment service is not configured; the agent then reports itself unavailable. */
	payment: Omit<PaymentConfig, 'fetchImpl' | 'now'> | null;
	sellerVKey: string | null;
	runnerIntervalMs: number;
	maxConcurrentCalls: number;
	/** Null when research hiring is off (no agents, no buy key, or fixed pricing). */
	research: {
		agents: string[];
		/** Spending-capped purchase key (`register-agent.mjs buyer-key`). */
		buyKey: string;
		timeoutMinutes: number;
	} | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentApiConfig {
	const realTelephony = (env.TELEPHONY_PROVIDER ?? 'mock').trim() !== 'mock';
	// With real telephony an unset allowlist means "dial nothing", never "dial anything".
	const policy: CallPolicy = { allowedNumbers: realTelephony ? parseAllowlist(env.DISPATCH_ALLOWED_NUMBERS) : null };

	const baseUrl = env.PAYMENT_SERVICE_URL;
	const token = env.MPS_PAY_KEY || env.ADMIN_KEY;
	const agentIdentifier = env.AGENT_IDENTIFIER;
	const sourceType = (env.PAYMENT_SOURCE_TYPE || 'Web3CardanoV2') as PaymentConfig['paymentSourceType'];
	if (sourceType !== 'Web3CardanoV1' && sourceType !== 'Web3CardanoV2') throw new Error(`PAYMENT_SOURCE_TYPE "${sourceType}" is not supported`);
	const pricing = (env.PRICING || 'dynamic').toLowerCase();
	if (pricing !== 'dynamic' && pricing !== 'fixed') throw new Error(`PRICING must be dynamic or fixed, got "${pricing}"`);

	const payment =
		baseUrl && token && agentIdentifier
			? {
					baseUrl,
					token,
					network: (env.NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod') as PaymentConfig['network'],
					agentIdentifier,
					paymentSourceType: sourceType,
					...(sourceType === 'Web3CardanoV2' ? { supportedPaymentSourceIndex: int(env, 'SUPPORTED_PAYMENT_SOURCE_INDEX', 0) } : {}),
					price:
						pricing === 'fixed'
							? null
							: {
									unit: env.USDM_UNIT || (() => { throw new Error('USDM_UNIT is required for dynamic pricing'); })(),
									amount: toAtomic(env.TASK_PRICE_USDM || '1'),
								},
					windows: {
						payBy: int(env, 'ESCROW_PAY_BY_MINUTES', 15),
						submitResult: int(env, 'ESCROW_SUBMIT_RESULT_MINUTES', 60),
						unlock: int(env, 'ESCROW_UNLOCK_MINUTES', 90),
						externalDispute: int(env, 'ESCROW_EXTERNAL_DISPUTE_MINUTES', 150),
					},
				}
			: null;
	if (payment) {
		const w = payment.windows;
		if (!(w.payBy < w.submitResult && w.submitResult < w.unlock && w.unlock < w.externalDispute)) {
			throw new Error('escrow windows must increase: pay-by < submit-result < unlock < external-dispute');
		}
	}

	// Research hiring spends the hirer's budget through a separately capped key, and
	// only works when each job is priced individually (dynamic pricing).
	const researchAgents = (env.DISPATCH_RESEARCH_AGENTS ?? '').split(',').map((a) => a.trim()).filter(Boolean);
	const bad = researchAgents.filter((a) => !/^[0-9a-f]{57,250}$/i.test(a));
	if (bad.length) throw new Error(`DISPATCH_RESEARCH_AGENTS has malformed agent identifiers: ${bad.join(', ')}`);
	const research =
		payment?.price && researchAgents.length && env.MPS_BUY_KEY
			? { agents: researchAgents, buyKey: env.MPS_BUY_KEY, timeoutMinutes: int(env, 'RESEARCH_TIMEOUT_MINUTES', 10) }
			: null;
	if (research && payment) {
		policy.maxResearchBudget = BigInt(toAtomic(env.RESEARCH_BUDGET_MAX_USDM || '2'));
		if (env.MPS_BUY_KEY === payment.token) throw new Error('MPS_BUY_KEY must be its own spending-capped key, not the seller key');
	}

	return {
		port: int(env, 'AGENT_API_PORT', 3013),
		jobsDir: env.JOBS_DIR || join(process.cwd(), '.local', 'jobs'),
		operatorToken: env.AGENT_API_TOKEN || undefined,
		policy,
		payment,
		sellerVKey: env.SELLER_VKEY || null,
		runnerIntervalMs: int(env, 'RUNNER_INTERVAL_MS', 15_000),
		maxConcurrentCalls: int(env, 'MAX_CONCURRENT_CALLS', 2) || 1,
		research,
	};
}
