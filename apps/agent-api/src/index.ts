import { AgentApi, createAgentApiServer } from './server.js';

/**
 * Entry point. Wires the API to its real dependencies.
 *
 * The payment-service hooks are stubbed until the seller wallet exists — seeding
 * requires a Blockfrost key and generates the wallet, which must happen exactly
 * once. Until then the agent reports itself unavailable, which is the honest
 * answer: it genuinely cannot be paid yet.
 */

const PORT = Number(process.env.AGENT_API_PORT ?? 3013);

const api = new AgentApi({
	registrationConfirmed: async () => Boolean(process.env.AGENT_IDENTIFIER),
	modelHealthy: async () => Boolean(process.env.ANTHROPIC_API_KEY),
	telephonyHealthy: async () => {
		const key = process.env.TELNYX_API_KEY;
		if (!key) return false;
		const res = await fetch('https://api.telnyx.com/v2/ai/assistants?page[size]=1', {
			headers: { Authorization: `Bearer ${key}` },
		});
		return res.ok;
	},
	createEscrow: async () => {
		throw new Error('payment service is not seeded yet — BLOCKFROST_API_KEY_PREPROD required');
	},
	agentIdentifier: () => process.env.AGENT_IDENTIFIER ?? null,
	sellerVKey: () => process.env.SELLER_VKEY ?? null,
});

createAgentApiServer(api, process.env.AGENT_API_TOKEN).listen(PORT, () => {
	console.log(`[agent-api] MIP-003 listening on :${PORT}`);
});
