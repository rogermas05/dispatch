#!/usr/bin/env node
/**
 * Checkpoint 4 evidence generator.
 *
 * Asks the Cardano chain directly whether test USDM reached the seller address,
 * and writes a JSON snapshot proving it.
 *
 * This exists because nothing else counts. A Sokosumi task marked COMPLETED
 * proves the product layer finished, not that anyone was paid. The payment
 * service reporting success is its own account of itself. Even the Sokosumi
 * receipt is documented to return settled with a null txHash. The submission
 * requires a judge to trace a task through to confirmed seller receipt, so the
 * only acceptable source is an independent chain query.
 *
 *   node scripts/verify-seller-receipt.mjs [--address addr_test1...] [--tx <hash>]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';

const USDM_UNIT = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';
const BASE = 'https://cardano-preprod.blockfrost.io/api/v0';
/**
 * Masumi V2 escrow script on Preprod. A collection moves USDM OUT of this
 * script into the seller wallet. Matching merely "inbound USDM" also matches
 * the faucet transaction that funded the wallet, which would put a dispenser
 * payout in the submission as proof of a customer payment.
 */
const ESCROW_SCRIPT = process.env.ESCROW_SCRIPT_ADDRESS
	?? 'addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g';

function loadEnv() {
	if (!existsSync('.env.local')) return;
	for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
		const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

async function bf(path, key) {
	const res = await fetch(`${BASE}${path}`, { headers: { project_id: key } });
	if (!res.ok) throw new Error(`blockfrost ${path} -> ${res.status} ${await res.text()}`);
	return res.json();
}

async function main() {
	loadEnv();
	const key = process.env.BLOCKFROST_API_KEY_PREPROD;
	if (!key) throw new Error('BLOCKFROST_API_KEY_PREPROD is not set');
	const address = arg('address') ?? process.env.SELLER_ADDRESS;
	if (!address) throw new Error('pass --address or set SELLER_ADDRESS');

	const info = await bf(`/addresses/${address}`, key);
	const usdm = (info.amount ?? []).find((a) => a.unit === USDM_UNIT);
	const lovelace = (info.amount ?? []).find((a) => a.unit === 'lovelace');

	// A collection transaction is the end of the escrow. Find the one that
	// actually moved USDM to us, rather than trusting a hash we were handed.
	const txs = await bf(`/addresses/${address}/transactions?order=desc&count=25`, key);
	const wanted = arg('tx');
	const collections = [];
	for (const t of txs) {
		if (wanted && t.tx_hash !== wanted) continue;
		const utxos = await bf(`/txs/${t.tx_hash}/utxos`, key);
		const received = utxos.outputs
			.filter((o) => o.address === address)
			.flatMap((o) => o.amount)
			.filter((a) => a.unit === USDM_UNIT)
			.reduce((sum, a) => sum + BigInt(a.quantity), 0n);
		// Net, not gross. The seller's own funds routinely appear as inputs and
		// return as change — the result-hash submission does exactly that, and
		// matching gross receipts reported it as a collection. A collection is a
		// transaction after which the seller holds MORE USDM than before.
		const inFromSeller = utxos.inputs
			.filter((i) => i.address === address)
			.flatMap((i) => i.amount)
			.filter((a) => a.unit === USDM_UNIT)
			.reduce((s, a) => s + BigInt(a.quantity), 0n);
		const net = received - inFromSeller;
		const fromEscrow = utxos.inputs.some((i) => i.address === ESCROW_SCRIPT);
		if (net > 0n && fromEscrow) {
			const tx = await bf(`/txs/${t.tx_hash}`, key);
			collections.push({
				txHash: t.tx_hash,
				blockHeight: t.block_height,
				blockTime: new Date(tx.block_time * 1000).toISOString(),
				usdmReceived: net.toString(),
				feesLovelace: tx.fees,
			});
		}
		if (wanted) break;
	}

	const confirmed = collections.length > 0;
	const snapshot = {
		checkpoint: 4,
		claim: 'Test USDM reached the seller wallet via a confirmed Preprod transaction',
		verdict: confirmed ? 'VERIFIED' : 'NOT YET',
		recordedAt: new Date().toISOString(),
		method: 'Direct Blockfrost query against Cardano Preprod. Independent of the payment service and of Sokosumi receipts, both of which report on themselves.',
		network: 'preprod',
		sellerAddress: address,
		usdmTokenUnit: USDM_UNIT,
		currentBalance: {
			usdm: usdm?.quantity ?? '0',
			lovelace: lovelace?.quantity ?? '0',
			note: 'ADA is required for fees and min-ADA on token UTXOs even though the job is priced in USDM.',
		},
		collectionTransactions: collections,
		explorer: collections[0]
			? `https://preprod.cardanoscan.io/transaction/${collections[0].txHash}`
			: null,
	};

	mkdirSync('.local', { recursive: true });
	const out = '.local/automated-seller-collection-proof.json';
	writeFileSync(out, JSON.stringify(snapshot, null, 2));

	console.log(JSON.stringify(snapshot, null, 2));
	console.log(`\n${confirmed ? '✅ VERIFIED' : '❌ no USDM receipt found'} — written to ${out}`);
	if (!confirmed) process.exitCode = 1;
}

main().catch((err) => {
	console.error('verification failed:', err.message);
	process.exitCode = 1;
});
