# token-origins

An AI agent that earns real money on Cardano.

Built for the **TOKEN2049 Cardano track** (Oct 6–8, 2026). The agent runs on the
[Masumi](https://www.masumi.network) protocol, is hired through the
[Sokosumi](https://preprod.sokosumi.com) marketplace, and settles in test USDM on
Cardano **Preprod** via on-chain escrow.

The deliverable is not an agent. It is **an agent plus a traceable payment** — a
confirmed Preprod transaction showing test USDM arriving in our seller wallet
after a task completed.

---

## Status

**Checkpoints 0 and 1 are VERIFIED.** Vendor, Coworker, and a `GRANTED` workspace
grant all exist on Preprod; evidence in `.local/`. Next up is Phase 2 — an agent
that completes an unpaid task end to end.

Local prereqs verified: Node v24.16.0,
PostgreSQL 17.11, Docker 29.8.1, Sokosumi CLI 1.0.4 (project-local).

Primary sources have been reconciled against the plan — see
[`docs/FINDINGS.md`](docs/FINDINGS.md). Two findings change the build materially:
the Sokosumi CLI **implements no payment path**, so Checkpoint 4 is entirely our own
payment-service integration; and there is **no worker lease**, so nothing but our own
journal prevents double-processing a task.

| Checkpoint | What it proves | State |
|---|---|---|
| 0 | Prereqs installed, Sokosumi auth works, `.env.local` exists | ✅ **VERIFIED** |
| 1 | Vendor + Coworker created, `workspaceAccess.status: GRANTED` | ✅ **VERIFIED** |
| 2 | A task reaches `COMPLETED` with a real result — unpaid | ☐ |
| 3 | `RegistrationConfirmed` on-chain; `/availability` returns 200; wallet funded | ☐ |
| 4 | **One paid task settles — confirmed collection tx, USDM received** | ☐ |
| 5 | Everything survives with all local machines off | ☐ |
| 6 | Connected to the TOKEN2049 org, submission assembled | ☐ |

Checkpoint 4 is the one that matters. Phases run strictly in order; each is
verified independently before the next begins.

---

## Evidence discipline

Every claim in this repo is labelled:

- **VERIFIED** — we measured it ourselves, and the JSON snapshot proving it is referenced.
- **REPORTED** — a tool, service, or person told us. Not yet independently confirmed.

A Sokosumi task marked `COMPLETED` is **REPORTED** payment, not verified payment —
the product layer completes a task immediately, while the chain says `Completed`
only after the collection transaction confirms. We query the chain directly rather
than trusting what the payment service reports.

Raw checkpoint snapshots are written to `.local/` (gitignored — they contain wallet
addresses and operational detail). Sanitized copies are promoted to
`docs/evidence/` for the public submission.

---

## Architecture

Four layers, deliberately kept distinct:

| Layer | Role |
|---|---|
| **Cardano** | Settlement ledger — USDM, eUTXO, Plutus escrow |
| **x402** | HTTP payment handshake — `402 Payment Required` + price → pay → retry with proof |
| **Masumi** | Agent protocol — on-chain identity, escrow lifecycle, decision logging, MIP-003 API |
| **Sokosumi** | Marketplace — buyers pay EUR credits; we receive USDM |

Three long-lived processes, each of which must stay alive:

| Process | Job | If it dies |
|---|---|---|
| **Agent** | Does the work (LLM + tools) | Tasks never execute |
| **Worker** | Polls Sokosumi for `READY` tasks → `RUNNING` → result → `COMPLETED` | Tasks sit unclaimed |
| **Masumi node** + Postgres | Submits result hashes and collection transactions | Work happens, we never get paid |

Signing keys stay out of the agent process. The agent reads untrusted input and is
prompt-injectable; the Masumi node owns the wallets.

---

## Operational rules

These are not style preferences. Each one maps to a way this project can fail
irrecoverably.

1. **`ENCRYPTION_KEY` *is* the seller wallet.** Same Postgres database and same key,
   always. Reseeding wallets on resume destroys the registry NFT and the agent can
   never be deregistered. Back the key up outside this repo.
2. **Exactly one worker per Coworker.** Two pollers double-process a task, which
   means duplicate charges — and "no repeats, no duplicate charges" is a stated
   judging criterion. Stop the execution-only worker before starting the paid one.
3. **The node must be alive when `unlockTime` passes.** Blockchains have no cron.
   Nothing pays us automatically; a process we run builds and submits the
   collection transaction. Offline at `unlockTime` means no payment and no valid
   submission.
4. **Fund the wallet with ADA even though jobs are priced in USDM.** Fees and
   min-ADA requirements on token UTXOs are paid in ADA.
5. **Never hand-roll the escrow release.** There is no `contract.release()` on
   Cardano. Releasing funds means locating the exact script UTXO, reconstructing
   the datum, setting a correct validity interval, supplying collateral, and
   surviving rollbacks. The payment service does this.
6. **Workspace membership ≠ Coworker connection.** Joining an organization does not
   connect the Coworker to it. Connect explicitly and verify `GRANTED`.
7. **Journal a task before writing to it.** Inspect any uncertain task before
   restarting a worker. There is no server-side lease; this is the only protection
   against double-processing that exists.
8. **Three credential tiers, never mixed.** Human OAuth for setup, the
   Coworker-scoped runtime key for execution, the payment-service wallet for money.
   Never substitute human credentials for runtime authentication.

---

## Setup

Requires Node.js 24+, PostgreSQL 13+, pnpm, and git.

```bash
cp .env.example .env.local
chmod 600 .env.local
# fill in .env.local — see the comments in .env.example
```

Full phase-by-phase build plan, including every checkpoint and the known failure
modes: [`docs/PLAN.md`](docs/PLAN.md). Verified corrections to it, with sources:
[`docs/FINDINGS.md`](docs/FINDINGS.md) — read this second, it overrides the plan
where they disagree.

Second builder joining the project: [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

Deployment steps are added at Phase 5.

### Live identifiers

| Thing | Value |
|---|---|
| Organization | `Substantiate` — `01a10fd0-67f5-709f-9874-4627dc671212` |
| Vendor | `Substantiate` — `01a10fd1-9907-77ba-92d0-ac202cedd643` |
| Coworker | `Substantiate Claims Checker` — `01a10fd1-dd7b-7415-91e1-0bf91fb6d76c` |
| Workspace | Personal — `01a10fc8-74b3-76c5-8281-53c228e71459`, access `GRANTED` |

Tasks run in the Personal Workspace: the free seat's 3,250 credits sit there,
while organization credits are a separate pool. The organization exists because
Vendor creation requires one. Connection to the TOKEN2049 organization
(`01a109d1-32a9-71a3-a0e3-658b2a7987cd`) is a Phase 6 step.

---

## Dashboard

The replay dashboard (`apps/web`) shows the Experience Network story ([`docs/SPEC.md`](docs/SPEC.md)):
tasks arriving from Sokosumi, search before work, purchases through escrow, published
experiences and royalties flowing back upstream.

```bash
npm install
npm run dev        # http://localhost:5173, plays the mock story feed
npm test           # schema, royalty vectors, replay logic
```

It reads one feed validated by `packages/schema` (`VITE_FEED_URL`, default
`/mock-feed.json`). Until the backend emits a live feed, everything shown is **mock**
data and is labelled that way on screen; the schema rejects a mock feed that claims a
verified transaction.

## What the agent does

Open decision, deliberately deferred. The infrastructure is concept-agnostic and
gets built against a placeholder; the logic is swapped in once Checkpoint 2 holds.

Any concept has to satisfy three constraints: the output is a **checkable
artifact** (a cited report, a dataset, a file — not a vibe), the value works at
roughly €0.05–7 per task, and it genuinely **matters** that the input and output
are provably logged, otherwise the chain is decoration.

Current default is a **regulated-claims checker** — scans marketing copy, flags
claims requiring substantiation (health, financial, environmental, EU DSA/GDPR),
and cites the specific rule behind each flag. Decision logging earns its place
here: we can later prove exactly what copy we were given and exactly what we
advised, which is an audit trail a compliance team would pay for.

---

## Security

No keys, seeds, or secrets belong in this repository — ever. `.gitignore` blocks
`.env*`, key material, and wallet files, but the rule is the discipline, not the
tooling. Wallet seeds are never pasted into a chat, an issue, or a commit message.
