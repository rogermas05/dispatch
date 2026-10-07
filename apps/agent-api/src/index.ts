import { planResearch, reportOutcome, synthesizeOutcomes } from '../../worker/src/agent.js';
import { selectProvider } from '../../worker/src/call/select.js';
import { PurchaseClient, RegistryClient, RemoteAgent } from './buyer/clients.js';
import { runHire } from './buyer/hire.js';
import { loadConfig } from './config.js';
import { executeJob, type ExecuteDeps } from './execute.js';
import { parseCallInput } from './input.js';
import { PaymentServiceClient, priceForJob, windowsForJob } from './payment.js';
import { JobRunner } from './runner.js';
import { AgentApi, createAgentApiServer } from './server.js';
import { JobStore } from './store.js';

/**
 * Entry point: the MIP-003 API other agents hire Dispatch through, plus the
 * runner that executes paid calls. One process, one replica — the runner and
 * the job store assume they are the only writer.
 */

const TELEPHONY_HEALTH_TTL_MS = 60_000;
const SHUTDOWN_GRACE_MS = 25_000;

const config = loadConfig();
const store = new JobStore(config.jobsDir);
const provider = selectProvider();
const payments = config.payment ? new PaymentServiceClient(config.payment) : null;

// /availability is polled by marketplaces; cache the Telnyx probe rather than hitting it every time.
let telephonyCheck: { at: number; ok: boolean } | null = null;
async function telephonyHealthy(): Promise<boolean> {
	if (telephonyCheck && Date.now() - telephonyCheck.at < TELEPHONY_HEALTH_TTL_MS) return telephonyCheck.ok;
	const ok = await provider.healthy().catch(() => false);
	telephonyCheck = { at: Date.now(), ok };
	return ok;
}

const api = new AgentApi({
	store,
	policy: config.policy,
	registrationConfirmed: async () => Boolean(config.payment?.agentIdentifier),
	modelHealthy: async () => Boolean(process.env.ANTHROPIC_API_KEY),
	telephonyHealthy,
	paymentServiceReady: async () => payments !== null,
	createEscrow: async ({ inputHash, identifierFromPurchaser, jobId, plan, brief }) => {
		if (!payments || !config.payment) throw new Error('payment service is not configured (PAYMENT_SERVICE_URL, MPS_PAY_KEY, AGENT_IDENTIFIER)');
		// Base fee + expected minutes + any research budget; windows fit every planned call.
		const price = config.payment.price
			? priceForJob(config.payment.price, {
					calls: plan.numbers.length,
					maxDurationSeconds: brief.maxDurationSeconds,
					researchBudget: plan.researchBudget,
				})
			: undefined;
		const windows = windowsForJob(config.payment.windows, {
			calls: plan.numbers.length,
			maxDurationSeconds: brief.maxDurationSeconds,
			researchMinutes: plan.researchBudget > 0n && config.research ? config.research.timeoutMinutes : 0,
		});
		const terms = await payments.createPayment(
			{ inputHash, identifierFromPurchaser, metadata: JSON.stringify({ jobId }) },
			{ price, windows },
		);
		return { ...terms, ...(price ? { requestedFunds: [price] } : {}) };
	},
	agentIdentifier: () => config.payment?.agentIdentifier ?? null,
	sellerVKey: () => config.sellerVKey,
	paymentSource: () =>
		config.payment
			? {
					paymentSourceType: config.payment.paymentSourceType,
					...(config.payment.supportedPaymentSourceIndex !== undefined
						? { supportedPaymentSourceIndex: config.payment.supportedPaymentSourceIndex }
						: {}),
				}
			: { paymentSourceType: 'Web3CardanoV2' },
});

// Research hires go through a separate, spending-capped buyer key on the same payment service.
const buyer =
	config.payment && config.research
		? (() => {
				const mps = { baseUrl: config.payment.baseUrl, token: config.research.buyKey, network: config.payment.network };
				return { registry: new RegistryClient(mps), purchases: new PurchaseClient(mps) };
			})()
		: null;

const executeDeps: ExecuteDeps = {
	placeAndReport: async (brief) => reportOutcome(brief, await provider.place(brief)),
	planResearch,
	synthesize: synthesizeOutcomes,
	researchAgents: config.research?.agents ?? [],
	unit: config.payment?.price?.unit ?? '',
	researchTimeoutMs: (config.research?.timeoutMinutes ?? 10) * 60_000,
	...(buyer
		? {
				hire: (req, initial, save) =>
					runHire(req, initial, {
						lookup: (id) => buyer.registry.lookup(id),
						remote: (baseUrl) => new RemoteAgent(baseUrl),
						purchase: (terms, nonce, amount, metadata) => buyer.purchases.purchase(terms, nonce, amount, metadata),
						resolvePurchase: (id) => buyer.purchases.resolve(id),
						save,
					}),
			}
		: {}),
};

const runner = payments
	? new JobRunner({
			store,
			payments,
			parse: parseCallInput,
			policy: config.policy,
			execute: (input) => executeJob(input, executeDeps),
			maxConcurrentCalls: config.maxConcurrentCalls,
		})
	: null;

const server = createAgentApiServer(api, config.operatorToken).listen(config.port, () => {
	console.log(
		`[agent-api] MIP-003 listening on :${config.port}, telephony=${provider.name}, payments=${payments ? 'configured' : 'NOT configured'}, ` +
			`research=${config.research ? `${config.research.agents.length} agent(s)` : 'off'}`,
	);
	if (config.policy.allowedNumbers?.size === 0) {
		console.warn('[agent-api] DISPATCH_ALLOWED_NUMBERS is empty: every start_job will be refused until numbers are allowed.');
	}
});
runner?.start(config.runnerIntervalMs);

// Redeploys send SIGTERM. Stop taking work and give an in-flight call a moment to
// finish; a call cut off here is failed on restart, never re-dialed.
async function shutdown(signal: string): Promise<void> {
	console.log(`[agent-api] ${signal}: shutting down`);
	runner?.stop();
	server.close();
	await Promise.race([runner?.idle(), new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS))]);
	process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
