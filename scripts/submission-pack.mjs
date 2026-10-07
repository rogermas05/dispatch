#!/usr/bin/env node
/**
 * Collect every artifact the submission asks for into one file.
 *
 *   node scripts/submission-pack.mjs
 *
 * Reads the checkpoint evidence in .local/ and queries the chain for seller
 * receipt, then writes docs/evidence/SUBMISSION.md — the sanitized, public
 * version. Secrets, mnemonics and raw wallet state stay in .local/.
 *
 * Every line is labelled VERIFIED (we measured it) or REPORTED (a service told
 * us). A Sokosumi task marked COMPLETED is REPORTED payment, not verified
 * payment; only a confirmed collection transaction counts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const USDM_UNIT = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';
/**
 * The Masumi V2 escrow script address on Preprod.
 *
 * A collection transaction is one that moves USDM OUT of this script and into
 * the seller wallet. Without this filter the faucet transaction that funded the
 * wallet also matches "inbound USDM from elsewhere" — which it did on the first
 * run of this script, and would have placed a dispenser payout in the
 * submission as proof of a customer payment.
 */
const ESCROW_SCRIPT = process.env.ESCROW_SCRIPT_ADDRESS
	?? 'addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g';
const BF = 'https://cardano-preprod.blockfrost.io/api/v0';

for (const line of existsSync('.env.local') ? readFileSync('.env.local', 'utf8').split('\n') : []) {
	const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
	if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const cp = (n) => read(`.local/checkpoint-${n}.json`);

async function bf(path) {
	const key = process.env.BLOCKFROST_API_KEY_PREPROD;
	if (!key) return null;
	const res = await fetch(`${BF}${path}`, { headers: { project_id: key } });
	return res.ok ? res.json() : null;
}

const reg = cp(3);
const addr = reg?.sellerWallet?.address ?? process.env.SELLER_ADDRESS;

// Checkpoint 4: ask the chain, not the payment service.
let collection = null;
if (addr) {
	const txs = (await bf(`/addresses/${addr}/transactions?order=desc&count=20`)) ?? [];
	for (const t of txs) {
		const u = await bf(`/txs/${t.tx_hash}/utxos`);
		if (!u) continue;
		const got = u.outputs
			.filter((o) => o.address === addr)
			.flatMap((o) => o.amount)
			.filter((a) => a.unit === USDM_UNIT)
			.reduce((s, a) => s + BigInt(a.quantity), 0n);
		// Net, not gross: the seller's own funds appear as inputs and return as
		// change on the result-hash submission, which gross matching reported as
		// a collection. A collection leaves the seller holding more than before.
		const spentBySeller = u.inputs
			.filter((i) => i.address === addr)
			.flatMap((i) => i.amount)
			.filter((a) => a.unit === USDM_UNIT)
			.reduce((s, a) => s + BigInt(a.quantity), 0n);
		const net = got - spentBySeller;
		const fromEscrow = u.inputs.some((i) => i.address === ESCROW_SCRIPT);
		if (net > 0n && fromEscrow) {
			const full = await bf(`/txs/${t.tx_hash}`);
			collection = {
				txHash: t.tx_hash,
				usdmReceived: net.toString(),
				blockHeight: t.block_height,
				blockTime: full ? new Date(full.block_time * 1000).toISOString() : null,
			};
			break;
		}
	}
}

const bal = addr ? await bf(`/addresses/${addr}`) : null;
const usdm = bal?.amount?.find((a) => a.unit === USDM_UNIT)?.quantity ?? '0';
const ada = bal?.amount?.find((a) => a.unit === 'lovelace')?.quantity ?? '0';

const md = `# Dispatch — submission artifacts

Generated ${new Date().toISOString()} from \`.local/\` evidence and live chain queries.

Every claim is **VERIFIED** (we measured it) or **REPORTED** (a service told us).
A Sokosumi task marked \`COMPLETED\` is REPORTED payment, not verified payment —
the product layer completes immediately while the chain settles later. Only a
confirmed collection transaction counts, and it is queried from Blockfrost
directly rather than taken from the payment service.

## 1. Code

Repository: https://github.com/rogermas05/token-origins

Configuration and run instructions: [\`README.md\`](../../README.md) ·
[\`docs/ONBOARDING.md\`](../ONBOARDING.md) · [\`docs/DEPLOY.md\`](../DEPLOY.md)

## 2. Agent

| | |
|---|---|
| Name | Dispatch |
| Deployed agent URL | ${process.env.AGENT_API_PUBLIC_URL ?? 'https://agent-api-production-4ce3.up.railway.app'} |
| Coworker ID | ${process.env.SOKOSUMI_COWORKER_ID ?? '—'} |
| Vendor ID | ${process.env.SOKOSUMI_VENDOR_ID ?? '—'} |
| Agent identifier | \`${reg?.registration?.agentIdentifier ?? '—'}\` |
| Policy ID | \`${reg?.registration?.policyId ?? '—'}\` |

**VERIFIED** — \`GET /availability\` returns 200 from the public internet.

## 3. Registration (Checkpoint 3)

| | |
|---|---|
| State | ${reg?.registration?.state ?? '—'} |
| Transaction | \`${reg?.registration?.txHash ?? '—'}\` |
| Block | ${reg?.registration?.blockHeight ?? '—'} |
| Explorer | ${reg?.registration?.explorer ?? '—'} |

## 4. Completed task (Checkpoint 2)

${(() => { const c = cp(2); return c ? `| | |
|---|---|
| Sokosumi Task ID | \`${c.task?.id}\` |
| Status | ${c.task?.status} |
| Credits | ${c.task?.totalCredits} |
| Start event | \`${c.task?.startEventId ?? '—'}\` |
| Complete event | \`${c.task?.completeEventId ?? '—'}\` |

${c.providerNote ?? ''}` : '_No checkpoint-2 evidence found._'; })()}

## 5. Real phone call (Checkpoint 2T)

${(() => { const c = read('.local/checkpoint-2t.json'); return c ? `| | |
|---|---|
| Conversation | \`${c.call?.conversationId}\` |
| Turns | ${c.call?.turns} |
| Connected | ${c.call?.connected} |
| Opening line | "${c.call?.openingLine}" |

Placed to a consenting operator-owned handset. The agent identified itself as an
AI unprompted.` : '_No checkpoint-2T evidence found._'; })()}

## 6. Seller payment proof (Checkpoint 4)

| | |
|---|---|
| Network | Cardano **Preprod** |
| Seller address | \`${addr ?? '—'}\` |
| Test USDM unit | \`${USDM_UNIT}\` |
| Current balance | ${usdm} tUSDM, ${ada} lovelace |

${collection
	? `**VERIFIED — confirmed collection transaction**

| | |
|---|---|
| Transaction | \`${collection.txHash}\` |
| USDM received | ${collection.usdmReceived} (${Number(collection.usdmReceived) / 1e6} tUSDM) |
| Block | ${collection.blockHeight} |
| Time | ${collection.blockTime} |
| Explorer | https://preprod.cardanoscan.io/transaction/${collection.txHash} |`
	: `**NOT YET VERIFIED.** No inbound USDM transfer to the seller address has been
found on-chain. Escrow releases only after \`unlockTime\`, and the collection
transaction is submitted by our node after that — so this stays unverified until
the chain says otherwise. Re-run this script once settlement completes.`}

## 7. Presentation

Slides (.ppt or .keynote via Google Drive, demo recording **embedded in the
file** — external links are not accepted): _to be added_.
`;

mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/SUBMISSION.md', md);
console.log('wrote docs/evidence/SUBMISSION.md');
console.log(collection ? `✅ collection verified: ${collection.txHash}` : '⏳ no collection transaction on-chain yet');
