#!/usr/bin/env node
/**
 * Register Dispatch on the Masumi registry (Checkpoint 3) so other agents can
 * find and hire it — including through Sokosumi's `agents list` / `agents hire`.
 *
 *   node scripts/register-agent.mjs inspect    show the seller wallet and V2 payment source that will be used
 *   node scripts/register-agent.mjs key        create the scoped pay key the agent API uses (MPS_PAY_KEY)
 *   node scripts/register-agent.mjs buyer-key  create the spending-capped key Dispatch hires other agents with (MPS_BUY_KEY)
 *   node scripts/register-agent.mjs register   mint the registry entry with apiBaseUrl = AGENT_API_PUBLIC_URL
 *   node scripts/register-agent.mjs status     poll until RegistrationConfirmed; prints AGENT_IDENTIFIER
 *
 * Reads PAYMENT_SERVICE_URL, ADMIN_KEY, SELLER_VKEY, AGENT_API_PUBLIC_URL (and
 * optionally PAYMENT_SOURCE_ID) from the environment, e.g. `node --env-file=.env.local ...`.
 *
 * Registration mints an NFT carrying apiBaseUrl, so the URL must already be the
 * stable public one (DEPLOY.md). Each write records a *pending* marker first; an
 * uncertain outcome stops the script for inspection instead of writing twice.
 * State and evidence go to .local/registration.json (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const STATE_PATH = '.local/registration.json';
const KEY_PATH = '.local/mps-pay-key.env';
const BUY_KEY_PATH = '.local/mps-buy-key.env';
const NETWORK = process.env.NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod';

const LISTING = {
	name: 'Dispatch',
	// 250 characters max; this is what buyers and searching agents read.
	description:
		'Phones businesses for you or your agent: navigates menus, waits on hold, works your objective within your authorization. Can compare several numbers and hire research agents first. Returns transcripts + reference numbers.',
	Tags: ['phone-call', 'voice', 'telephony', 'calls', 'customer-support', 'hold-time', 'ivr', 'quotes', 'agent-tool'],
	Capability: { name: process.env.MODEL_ID || 'claude-sonnet-5-5', version: '1' },
	Author: { name: process.env.REGISTRY_AUTHOR || 'Dispatch' },
};

function need(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};
function save() {
	mkdirSync('.local', { recursive: true });
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function mps(path, body) {
	const base = need('PAYMENT_SERVICE_URL').replace(/\/$/, '');
	const res = await fetch(`${base}${path}`, {
		method: body ? 'POST' : 'GET',
		redirect: 'error',
		signal: AbortSignal.timeout(60_000),
		headers: { token: need('ADMIN_KEY'), 'content-type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || json?.status !== 'success') {
		throw new Error(`MPS ${path} -> HTTP ${res.status}: ${JSON.stringify(json?.error ?? json?.message ?? json).slice(0, 400)}`);
	}
	return json.data;
}

async function sellerWallet() {
	const vkey = need('SELLER_VKEY');
	const { Wallets = [] } = await mps(`/wallet/list?walletType=Selling&walletVkey=${encodeURIComponent(vkey)}&take=10`);
	if (Wallets.length !== 1) throw new Error(`expected exactly one Selling wallet with SELLER_VKEY, found ${Wallets.length}`);
	return Wallets[0];
}

async function paymentSource() {
	const { PaymentSources = [] } = await mps('/payment-source?take=100');
	const wanted = process.env.PAYMENT_SOURCE_ID;
	const candidates = PaymentSources.filter(
		(s) => s.network === NETWORK && s.paymentSourceType === 'Web3CardanoV2' && (!wanted || s.id === wanted),
	);
	if (candidates.length !== 1) {
		throw new Error(
			`expected one ${NETWORK} Web3CardanoV2 payment source, found ${candidates.length}` +
				(wanted ? '' : '; set PAYMENT_SOURCE_ID to choose'),
		);
	}
	return candidates[0];
}

async function inspect() {
	const [wallet, source] = await Promise.all([sellerWallet(), paymentSource()]);
	console.log(JSON.stringify({ network: NETWORK, wallet: { id: wallet.id, address: wallet.walletAddress }, paymentSource: { id: source.id, smartContractAddress: source.smartContractAddress } }, null, 2));
}

async function createKey() {
	if (state.payKeyId) return console.log(`pay key already created (${state.payKeyId}); it is in ${KEY_PATH}`);
	if (state.payKeyPending) throw new Error('a previous key creation had an uncertain outcome; inspect API keys in the MPS admin UI before retrying');
	const wallet = await sellerWallet();
	state.payKeyPending = true;
	save();
	const key = await mps('/api-key', {
		usageLimited: 'false',
		UsageCredits: [],
		NetworkLimit: [NETWORK],
		ChainIdLimit: [],
		canRead: true,
		canPay: true,
		canAdmin: false,
		walletScopeEnabled: true,
		WalletScopeHotWalletIds: [wallet.id],
		x402WalletScopeEnabled: true,
		X402WalletScopeEvmWalletIds: [],
	});
	state.payKeyId = key.id;
	state.payKeyPending = false;
	save();
	if (typeof key.token !== 'string' || key.token.startsWith('*')) throw new Error(`key ${key.id} created but its token was not revealed; rotate it in the admin UI`);
	writeFileSync(KEY_PATH, `MPS_PAY_KEY=${key.token}\n`, { mode: 0o600 });
	console.log(`created scoped pay key ${key.id} (read+pay, ${NETWORK}, seller wallet only). Token written to ${KEY_PATH}; set it as MPS_PAY_KEY.`);
}

/**
 * The key Dispatch spends with when it hires other agents. Scoped to the
 * purchasing wallet and capped by the payment service itself, so no bug in
 * Dispatch can spend past BUYER_SPEND_CAP_USDM in total.
 */
async function createBuyerKey() {
	if (state.buyKeyId) return console.log(`buyer key already created (${state.buyKeyId}); it is in ${BUY_KEY_PATH}`);
	if (state.buyKeyPending) throw new Error('a previous buyer-key creation had an uncertain outcome; inspect API keys before retrying');
	const unit = need('USDM_UNIT');
	const capUsdm = process.env.BUYER_SPEND_CAP_USDM || '10';
	if (!/^\d+(\.\d{1,6})?$/.test(capUsdm)) throw new Error('BUYER_SPEND_CAP_USDM must be a decimal tUSDM amount');
	const [whole, fraction = ''] = capUsdm.split('.');
	const capAtomic = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString();
	const { Wallets = [] } = await mps('/wallet/list?walletType=Purchasing&take=10');
	if (Wallets.length !== 1) throw new Error(`expected exactly one Purchasing wallet, found ${Wallets.length}; fund one in the MPS admin UI`);
	state.buyKeyPending = true;
	save();
	const key = await mps('/api-key', {
		usageLimited: 'true',
		UsageCredits: [{ unit, amount: capAtomic }],
		NetworkLimit: [NETWORK],
		ChainIdLimit: [],
		canRead: true,
		canPay: true,
		canAdmin: false,
		walletScopeEnabled: true,
		WalletScopeHotWalletIds: [Wallets[0].id],
		x402WalletScopeEnabled: true,
		X402WalletScopeEvmWalletIds: [],
	});
	state.buyKeyId = key.id;
	state.buyKeyPending = false;
	state.buyKeyCap = { unit, amount: capAtomic };
	save();
	if (typeof key.token !== 'string' || key.token.startsWith('*')) throw new Error(`key ${key.id} created but its token was not revealed; rotate it in the admin UI`);
	writeFileSync(BUY_KEY_PATH, `MPS_BUY_KEY=${key.token}\n`, { mode: 0o600 });
	console.log(`created buyer key ${key.id}: purchasing wallet ${Wallets[0].walletAddress}, capped at ${capUsdm} tUSDM in total. Token in ${BUY_KEY_PATH}; set it as MPS_BUY_KEY.`);
}

async function register() {
	if (state.registrationId) return console.log(`already registered (${state.registrationId}); run "status"`);
	if (state.registrationPending) throw new Error('a previous registration had an uncertain outcome; run "status" and inspect the registry before retrying');
	const apiBaseUrl = need('AGENT_API_PUBLIC_URL').replace(/\/$/, '');
	if (!apiBaseUrl.startsWith('https://')) throw new Error('AGENT_API_PUBLIC_URL must be the stable public https URL; it is minted into the NFT');

	// The URL must answer before it is minted permanently into the registry entry.
	const schema = await fetch(`${apiBaseUrl}/input_schema`, { signal: AbortSignal.timeout(15_000) });
	if (!schema.ok) throw new Error(`${apiBaseUrl}/input_schema returned HTTP ${schema.status}; deploy the agent API first`);

	const [wallet, source] = await Promise.all([sellerWallet(), paymentSource()]);
	const body = {
		network: NETWORK,
		type: 'Standard',
		sellingWalletVkey: wallet.walletVkey,
		supportedPaymentSources: [
			{ chain: 'Cardano', network: NETWORK, paymentSourceType: 'Web3CardanoV2', address: source.smartContractAddress, pricing: { pricingType: 'Dynamic' } },
		],
		ExampleOutputs: [],
		apiBaseUrl,
		...LISTING,
	};
	state.registrationPending = true;
	state.request = body;
	save();
	const entry = await mps('/registry', body);
	state.registrationId = entry.id;
	state.registrationPending = false;
	state.registration = entry;
	save();
	console.log(`registration submitted (${entry.id}). Run "status" until RegistrationConfirmed.`);
}

function find(node, id) {
	if (Array.isArray(node)) {
		for (const child of node) {
			const hit = find(child, id);
			if (hit) return hit;
		}
	} else if (node && typeof node === 'object') {
		if (node.id === id) return node;
		for (const child of Object.values(node)) {
			const hit = find(child, id);
			if (hit) return hit;
		}
	}
	return null;
}

async function status() {
	if (!state.registrationId) throw new Error('nothing registered yet; run "register"');
	const registry = await mps(`/registry?network=${NETWORK}&filterPaymentSourceType=Web3CardanoV2&limit=100`);
	const entry = find(registry, state.registrationId);
	if (!entry) throw new Error(`registration ${state.registrationId} not found in the registry listing`);
	state.registration = entry;
	state.checkedAt = new Date().toISOString();
	save();
	console.log(JSON.stringify({ id: entry.id, state: entry.state, agentIdentifier: entry.agentIdentifier ?? null, transaction: entry.CurrentTransaction ?? null, error: entry.error ?? null }, null, 2));
	if (entry.state === 'RegistrationConfirmed' && entry.agentIdentifier) {
		console.log(`\nSet AGENT_IDENTIFIER=${entry.agentIdentifier} on the agent API, then verify: npx sokosumi agents list --search Dispatch --json`);
	}
}

const commands = { inspect, key: createKey, 'buyer-key': createBuyerKey, register, status };
const command = commands[process.argv[2]];
if (!command) {
	console.error(`usage: node scripts/register-agent.mjs <${Object.keys(commands).join('|')}>`);
	process.exit(2);
}
command().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
