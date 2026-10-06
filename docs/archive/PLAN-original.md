# TOKEN2049 Cardano Track — Agentic Payments Build Plan

**Status:** handoff document. Written 2026-10-06. Hackathon window is Oct 6–8, 2026 (36h build period).
**Audience:** the implementing agent. You have no prior conversation context; everything you need is here.
**Scope of this document:** build the **barebones** complete submission. Enhancements are listed in §12 but are explicitly OUT OF SCOPE until §8 Phase 5 passes.

---

## 1. The mission, in one paragraph

Build an AI agent, get it running live on **Cardano Preprod** testnet using the **Masumi** standard, register it on the **Sokosumi** marketplace (preprod), and prove that a real on-chain payment in test USDM reached our seller wallet after the agent completed a task. The deliverable is not "an agent" — it is **an agent plus a traceable payment**. Judges care most about the second half, because that's where teams run out of time.

Track organizers (Patrick Tobler / NMKR, and Sandro) stated the goal plainly: get genuinely useful agents live on the marketplace, with the intent to keep them live for real users after the hackathon.

---

## 2. Mental model — four distinct layers

Do not collapse these. Nearly all confusion in this ecosystem comes from conflating them.

| Layer | What it is | Analogy |
|---|---|---|
| **Cardano** | Settlement ledger. Native stablecoin (USDM), deterministic fees, smart contracts as escrow | ACH / card network |
| **x402** | An HTTP standard: server answers with `402 Payment Required` + a price; client pays on-chain and retries with proof; server verifies and serves | HTTP-level checkout |
| **Masumi** | The agent protocol: on-chain identity, escrow lifecycle, decision logging, and a standard agent API (MIP-003) | Stripe Connect + a notary |
| **Sokosumi** | The marketplace where humans hire agents per task and pay in credits | Upwork |

Key facts per layer:

**x402** defines three transfer methods, which are a dial not a menu:
1. **Address payment** — direct transfer. Instant, no protection. Right for cheap metered API calls.
2. **Masumi escrow** — funds lock against job terms, released after a dispute window. Right for minute-long contestable work. **This is what we use.**
3. **Custom smart-contract lock** — seller-declared rules.

**Masumi** has three pillars:
1. **Identity** — registering an agent mints an NFT on Cardano via the Registry contract. Your `agentIdentifier` is a 64-char lowercase hex string derived from the NFT asset name, alongside a `policyId` (56 hex chars). The NFT lives in the agent's payment wallet. **Lose the wallet and you can never deregister.**
2. **Payments** — a smart contract holds funds in escrow. Nobody has custody: not buyer, not seller, not Masumi, not the facilitator.
3. **Decision logging** — SHA-256 hashes of input and output are written on-chain. This proves **integrity, not correctness**: a hash match proves we delivered exactly what we committed to the ledger. It does not prove the output was good.

**Masumi is NOT an agent framework.** It is deliberately framework-agnostic (CrewAI, LangGraph, eve, raw TS all fine). It wraps money + identity + proof around an agent that already works.

---

## 3. The escrow state machine

```
FundsLockingRequested ──► FundsLocked ──► ResultSubmitted ──► Completed
       (buyer only)         (both)            (both)           (both)
                                 │                │
                                 │     RefundRequested ──► RefundAuthorized
                                 │                │
                                 │            Disputed ──► escalated to Masumi team (human, off-chain)
```

Three deadlines are issued at job start and govern everything:

| Deadline | Meaning | Miss it → |
|---|---|---|
| `payByTime` | buyer must lock funds by this time | job dies |
| `submitResultTime` | seller must submit result hash by this time | buyer gets refunded |
| `unlockTime` | dispute window closes | seller may now collect |
| `externalDisputeUnlockTime` | outer bound for escalated disputes | — |

**Critical consequences for our architecture:**

- **Funds lock BEFORE work starts.** `FundsLocked` is the green light to begin, not a holding pen after delivery. Escrow is bilateral: it protects the buyer from paying for nothing AND the seller from working for nothing.
- **There is no single moment called "the end."** Settlement is at minimum **two transactions separated by hours**: (a) submit result hash, before `submitResultTime`; (b) submit a collection tx, after `unlockTime`.
- **Blockchains have no cron.** Nothing pays us when `unlockTime` expires. A process we run must build and submit the collection transaction. **If our node is down at `unlockTime`, we do not get paid and we have no submission.**
- "Done" = seller asserts + buyer's silence ratifies. Optimistic settlement with a chargeback window. There is no on-chain quality oracle.

---

## 4. How money actually flows (Sokosumi path)

```
   FIAT RAIL                               CRYPTO RAIL
1. Buyer buys a seat → credits (EUR, Stripe)
2. Buyer creates a Task; price shown before it runs
                          ├──────────────► 3. Sokosumi's node locks USDM
                                              FundsLockingRequested → FundsLocked (30–120s)
4. OUR worker polls, sees READY ◄─────────────┘
5. OUR agent runs
6. Result returned → Task COMPLETED (product layer)
                          ├──────────────► 7. OUR Masumi node submits result hash
                                              ResultSubmitted — dispute window opens
8. Buyer may object ──────────────────────► RefundRequested / Disputed
   ...or stays silent
                                           9. unlockTime passes
                                              OUR node submits collection tx
                                              → Completed. USDM in our seller wallet.
```

**Two rails, one transaction.** Buyer pays fiat (EUR seats: Free/250 credits, Starter €25/1,500, Standard €75/5,000, Pro €200/15,000; tasks cost ~3–400 credits). We get paid USDM on Cardano. Sokosumi is the bridge and eats the conversion. Buyer never touches crypto; we never touch fiat.

**Step 6 and step 9 are different layers.** Sokosumi marks a Task `COMPLETED` immediately; the chain says `Completed` only after collection. A completed Task proves nothing about payment. This is exactly why judges require the collection tx hash and not a screenshot.

Note: Sokosumi's ToS refunds buyers **in credits only, never fiat**, and scopes disputes to the "Unlock Time" — i.e. Masumi's on-chain `unlockTime` is the contractual dispute window. Buyers therefore have weak incentive to dispute; in practice `unlockTime` quietly expires and sellers collect.

---

## 5. Sokosumi object model

- **Vendor** — our publisher identity.
- **Coworker** — a registered agent instance with its own API key.
- **Workspace** — Personal or organization. A Coworker must be *connected* to a Workspace to be usable there.
- **Task** — a unit of work. Lifecycle `READY → RUNNING → COMPLETED`. Tasks support **human comments**, which a good agent answers within the same session.

> **GOTCHA:** Workspace membership ≠ Coworker connection. Joining the TOKEN2049 org Workspace does not connect your Coworker to it. The official reference implementation got caught by exactly this. Connect explicitly and verify `workspaceAccess.status: GRANTED`.

---

## 6. Two integration shapes — we need both

**Shape A — Classic Masumi (MIP-003).** We host an HTTP server; buyers push jobs at us. We are a server.

MIP-003 required endpoints:

| Method | Path | Notes |
|---|---|---|
| POST | `/start_job` | body: `identifier_from_purchaser` (14–26 char hex nonce), `input_data`. Returns `id`, `blockchainIdentifier`, `payByTime`, `submitResultTime`, `unlockTime`, `externalDisputeUnlockTime`, `agentIdentifier`, `sellerVKey`, `identifierFromPurchaser`, `input_hash` |
| GET | `/status?job_id=` | `status` ∈ `awaiting_payment`, `awaiting_input`, `running`, `completed`, `failed`; plus optional `result` |
| GET | `/availability` | `status` ∈ `available`/`unavailable`, `type` |
| GET | `/input_schema` | returns `input_data` OR `input_groups`, never both |
| POST | `/provide_input` | body: `job_id`, `input_schema_hash`, `input_data` |
| GET | `/demo` | optional |

Input field types: `string`, `number`, `boolean`, `option`, `none`.

**Shape B — Sokosumi Coworker.** Sokosumi owns the task queue; **our worker polls** for `READY` Tasks. We are a client. No inbound URL needed for execution — but we need a **persistently running process**.

**We implement both.** Shape B executes the work; Shape A + the Masumi node settle the payment. The reference implementation runs these as two separate executors.

---

## 7. The three long-lived processes

| Process | Job | If it dies |
|---|---|---|
| **Agent** | does the actual work (LLM + tools) | Tasks never execute |
| **Worker** | polls Sokosumi for `READY` Tasks → `RUNNING` → writes result → `COMPLETED` | Tasks sit unclaimed |
| **Masumi Payment Service node** + Postgres | watches chain, submits result hashes, submits collection txs | work happens, we never get paid |

**Exactly one worker per Coworker.** Two pollers will double-process a Task, and "no repeats, no duplicate charges" is a stated judging criterion. There is an execution-only worker and a paid worker — **stop the execution-only one before starting the paid one.**

Keep signing keys out of the agent process. The agent reads untrusted input and is prompt-injectable; the Masumi node owns the wallets.

---

## 8. Build plan — phases with hard checkpoints

Do these strictly in order. Verify each checkpoint independently before moving on. Save evidence to `.local/*.json` as you go (see §10) — the official reference repo does this and it is what makes the submission defensible.

### Phase 0 — Prereqs (target: 30 min)
- Node.js **24+**, PostgreSQL **13+**, pnpm (reference used `10.30.2`), git. Docker optional for the DB.
- Create Sokosumi Preprod account: https://preprod.sokosumi.com/signup
- `npm i -g @masumi_network/sokosumi`
- `sokosumi --preprod auth whoami` → must succeed
- Get a free **Blockfrost** API key, **Preprod** network.
- Get a model provider key. Reference used `glm-5.3-flash` via Z.ai (`https://api.z.ai/api/coding/paas/v4`, env `ZAI_API_KEY`) specifically to keep token cost near zero. Model billing is separate from Workspace credits.
- Create `.env.local` with permissions `600`. **No secrets in git, ever, and never paste a wallet seed into a chat.**

**CHECKPOINT 0:** `auth whoami` returns our identity; `.env.local` exists and is gitignored.

### Phase 1 — Vendor + Coworker (target: 45 min)
- Join or create an organization (required before a Vendor can exist).
- Create Vendor, then register/provision the Coworker, then connect it to a Workspace, then pull its API key.
- Record **Vendor ID** and **Coworker ID** immediately — everything downstream needs them.

**CHECKPOINT 1:** `.local/coworker.json` records the Coworker ID, Vendor ID, and `workspaceAccess.status: GRANTED`.

### Phase 2 — Agent that works, unpaid (target: 4–6 h)
- Scaffold from the demo template: https://github.com/masumi-network/demo-agent-token2049 — read branch `feat/token2049-event-guide` and its PR #1, plus PR #2 (`live-demo-name-finder`). **These are the single most useful artifacts available; read them before writing code.**
- Recommended framework: **Vercel eve** (filesystem-first — an agent is a directory of markdown + TS defining instructions, skills, tools, channels, schedule; durable execution, sandboxed VMs). It is in public **beta**, so APIs may have drifted; verify against current docs.
- Disable default tools you don't need. Keep secrets out of agent context.
- The agent must: accept a Task, do one thing well, and **return results with source attribution**.
- Build the worker: poll for `READY` Tasks, journal each Task **before** writing, start it with its authoritative description plus existing human comments, save exact UTF-8 results, then mark `COMPLETED`.

**CHECKPOINT 2:** a Task created in the Sokosumi UI reaches `COMPLETED` with a real saved result, `executionOnly: true`, `totalCredits: 0`. Payment is not involved yet. Do not proceed until this is solid.

### Phase 3 — Masumi node + registration (target: 3–4 h)
- Stand up PostgreSQL and the Masumi Payment Service (MPS). Run migrations. Record the DB name and host.
- **Save the database encryption key somewhere safe. Never reseed or replace wallets on resume.** Same DB + same key, or the seller wallet is gone.
- Fund the seller wallet with test ADA from https://dispenser.masumi.network/ — **ADA is needed for fees even though the job is priced in USDM**, and token UTXOs have min-ADA requirements.
- Implement the MIP-003 endpoints (§6 Shape A). Reference served these on loopback port `3013` and **rejected paid jobs until registration and model health were confirmed** — copy that guard.
- Register the agent. Expect `RegistrationRequested` → poll until `RegistrationConfirmed`.

**CHECKPOINT 3:** `.local/registration.json` shows `RegistrationConfirmed`, with the registration tx hash, confirmation count, and the full `agentIdentifier`. `GET /availability` returns HTTP 200 `{"status":"available",...}`. A balance check shows ADA **and** test USDM at the seller address.

### Phase 4 — One paid task, end to end (target: 2–3 h)
- Add test credits to the Sokosumi account via Stripe test card `4242 4242 4242 4242`.
- **Stop the execution-only worker.** Start the paid worker.
- Run a paid Task priced at **1 test USDM**.
- Watch the escrow progress: `FundsLocked` → work → `ResultSubmitted` → wait out `unlockTime` → collection.
- Verify seller receipt **independently** of what MPS reports — query the chain directly.

**CHECKPOINT 4 (the one that matters most):** a confirmed Preprod collection transaction showing seller receipt — collection tx hash, seller address, USDM token unit, net amount received. Save as `.local/automated-seller-collection-proof.json`.

### Phase 5 — Host it, so it survives us closing the laptop (target: 2 h)
- Deploy the agent (eve → Vercel, with route authentication).
- Deploy MPS + Postgres (Railway).
- Deploy the worker as a persistent Railway service.
- **Test end-to-end with the laptop offline.** This is non-negotiable: the node must be alive when `unlockTime` passes.
- Keep everything running through the event.

**CHECKPOINT 5:** a Task completes and settles with all local machines off.

### Phase 6 — Event approval + submission (target: 1 h)
- Join the TOKEN2049 Workspace via the provided link.
- **Connect the existing Coworker to the event organization** (re-read the §5 gotcha).
- Request approval so other teams can see it. Keep the worker running.
- Assemble submission artifacts (§10) on BuilderBase.

---

## 9. Failure modes — read this twice

1. **Workspace membership ≠ Coworker connection.** Connect explicitly; verify `GRANTED`.
2. **Two workers = double-processed Tasks = duplicate charges.** One executor per Coworker. Stop execution-only before starting paid.
3. **Losing the Postgres encryption key, or reseeding wallets on resume, loses the seller wallet** — and with it the registry NFT, permanently.
4. **No ADA for fees** even on a USDM-priced job → transactions fail.
5. **Node down at `unlockTime`** → no collection tx → no payment → no valid submission.
6. **Submitting the result hash after `submitResultTime`** → buyer gets refunded, we get nothing.
7. **Cardano eUTXO is not EVM.** There is no `contract.release()`. Releasing funds means: find the exact UTXO at the script address via an indexer, decode and reconstruct the datum, build a tx with the right redeemer and a correct **validity interval** (Plutus can't read a clock, so deadlines are enforced by constraining when the tx is valid), supply collateral, satisfy min-ADA, compute fees, attach the script witness, sign, submit, survive rollbacks. **Do not hand-roll this. Let MPS do it.**
8. **UTXO contention.** Concurrent jobs share one wallet and one collateral; racing processes produce failed txs. MPS serializes and batches.
9. **Inspect an uncertain Task before restarting a worker.** Journal first, write after.
10. **eve is beta.** Expect API drift from any tutorial.

---

## 10. Required submission artifacts

1. **Public repo** with configuration guidance and deployment steps, **no keys or secrets**.
2. **Agent demo** showing input, the working agent, and real output — plus deployed agent URL, Coworker ID, a sample Task, and availability date.
3. **Completed Task evidence** — Sokosumi Task ID, Coworker ID, the result, and associated payment event IDs.
4. **Payment proof** — at least one confirmed Cardano Preprod transaction showing the seller receipt: confirmed collection tx hash, seller address, test USDM token unit, net amount received.
5. **Presentation slides** — `.ppt` or `.keynote` via Google Drive link, with the demo recording **embedded in the file**. External video links are not accepted.

Adopt the reference repo's evidence discipline: a `.local/` directory of JSON snapshots, each proving one claim, and a README that distinguishes **VERIFIED** (we measured it) from **REPORTED** (someone told us). The Masumi team writes their own docs in exactly this style; mirroring it reads as rigor.

### Judging criteria
- **Result quality** — does the output answer the Task accurately and usefully against source material?
- **Practical utility** — who would use this, and what does it decide vs. hand back to a human?
- **Reliable execution** — completes real Tasks without errors, repetition, or duplicate charges.
- **Verified payment** — can a judge trace a Task through to confirmed seller receipt on-chain?

---

## 11. What the agent should actually do

**This is the one open decision.** Phases 0–6 are concept-agnostic — build the infrastructure with a trivial placeholder agent, then swap the logic in. Do not block on this.

Constraints any concept must satisfy:
- Output is a **checkable artifact** (a report with citations, a dataset, a file) — not a vibe. The protocol can prove *what* was delivered, never that it was *good*, so quality should be self-evident from the artifact.
- Value must work at **per-task pricing of roughly €0.05–7** (3–400 credits at ~1.5–2 cents/credit — derived from seat pricing, not published).
- It should **matter** that input and output are provably logged, otherwise the chain is decoration and judges will notice.
- Demand side is **marketing teams** (Sokosumi's named customers include Deutsche Telekom, Allianz, Lufthansa, Samsung). The existing ~41 agents from 9 vendors are already crowded into research + content generation.

**Recommended default: a regulated-claims checker.** Scans marketing copy and flags claims requiring substantiation (health, financial, environmental, EU DSA/GDPR), returning a report that cites the specific rule per flag. Checkable artifact; stakes make the dispute window meaningful; decision logging is genuinely valuable because we can later prove exactly what copy we were given and exactly what we advised — an audit trail a compliance team would pay for.

---

## 12. Deferred enhancements — DO NOT START until Checkpoint 4 passes

Ranked by impact per hour. Attempt in this order if time remains.

1. **Public verifiable receipt page.** One URL per task showing input hash, output hash, the on-chain tx, and a recompute-SHA-256-in-browser button that turns green. Weaponizes decision logging and collapses the "verified payment" criterion into a permalink. Cheapest high-impact item.
2. **Calibrated-confidence output.** Label each claim verified vs. reported, cite source + retrieval timestamp, and state what the output cannot prove. Maps directly onto the result-quality criterion.
3. **Honest refusal with proactive refund.** When sources are too thin or the request is out of scope, authorize the refund instead of shipping plausible garbage. Demonstrates understanding of the escrow state machine beyond the happy path.
4. **Human-comment follow-ups reusing the saved session.** The reference repo flags this as superseding an earlier limitation, i.e. known-hard and known-valued. Most teams will force a new Task per follow-up.
5. **x402 side door.** Expose the same capability as a raw x402-paywalled endpoint via `@x402/cardano` against the hosted Preprod facilitator, alongside the Coworker. Shows the three transfer methods are a dial.
6. **Orchestrator / agent-to-agent payment (swing for the fences).** Mid-task, query the Masumi Registry, discover another registered agent, pay it from our own wallet, compose the result. Second-order on-chain payment inside one task — the thing Masumi exists for and almost nobody will demo. Pair with an on-chain spending cap.

---

## 13. Reference facts

**Canonical links**
- Masumi quickstart (most important): https://www.masumi.network/token2049
- Agent brief: https://www.masumi.network/token2049/agent
- Submission checklist: https://www.masumi.network/token2049/submission
- Masumi docs: https://www.masumi.network/dev/masumi/documentation
- MIP-003 spec: https://www.masumi.network/dev/masumi/mips/_mip-003
- Payments / escrow: https://www.masumi.network/dev/masumi/core-concepts/payments
- Identity: https://www.masumi.network/dev/masumi/core-concepts/identity
- Decision logging: https://www.masumi.network/dev/masumi/core-concepts/decision-logging
- Install node: https://www.masumi.network/dev/masumi/documentation/get-started/install-masumi-node
- Cardano x402 portal: https://developers.cardano.org/x402/
- x402 exact-scheme spec: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md
- x402 Cardano demo: https://github.com/cardano-foundation/x402-cardano-demo
- Demo agent template: https://github.com/masumi-network/demo-agent-token2049
- Sokosumi Preprod: https://preprod.sokosumi.com/
- Test ADA dispenser: https://dispenser.masumi.network/

**Values**
- Test USDM token unit (Preprod), as recorded by the reference implementation:
  `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d`
- x402 hosted facilitator, Preprod: `https://x402.preprod.dev.ecosyseng.cf-deployments.org`
- x402 hosted facilitator, Mainnet: `https://x402.mainnet.dev.ecosyseng.cf-deployments.org`
- Stripe test card for credits: `4242 4242 4242 4242`
- MIP-003 reference port used by the demo: `3013`
- `agentIdentifier`: 64 hex chars. `policyId`: 56 hex chars. `identifier_from_purchaser`: 14–26 char hex nonce.
- Input hash convention: **SHA-256 of input data, hex-encoded**.

**CLI commands — VERIFY BEFORE TRUSTING.** These were gathered from search results and PR titles, not from a rendered README (npm returned 403). The CLI is at version ~1.0.4 and moving fast. **Run `sokosumi --help` and `sokosumi <subcommand> --help` first.**
```
npm i -g @masumi_network/sokosumi
sokosumi --preprod auth whoami
sokosumi --preprod vendors create --name NAME --slug SLUG
sokosumi --preprod coworkers register
sokosumi --preprod coworkers provision --vendor-id VENDOR_ID --name NAME --capability tasks
sokosumi --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORG_ID --json
sokosumi --preprod coworkers api-key COWORKER_ID --json
sokosumi --preprod runtime run
# CLI 1.0.4 added --personal for Personal Workspace registration/connection/Task execution
```

**Script names used by the reference implementation** (useful as a shape to copy):
```
npm run payment:start        # start MPS
node scripts/payment-status.mjs
npm run agent:api            # MIP-003 endpoints
npm run worker -- --poll     # execution-only worker
npm run worker:paid -- --poll # paid worker (stop the above first)
```

---

## 14. Confidence log — what is verified vs. inferred

Written by the handoff author so you know where to double-check.

**Verified from primary sources:** the four-layer model; x402's three transfer methods; the escrow state names and the four deadlines; all MIP-003 endpoints, fields, and status enums; the identity/NFT/`agentIdentifier` model; Sokosumi's seat pricing in EUR and credit allocations; the submission artifact list and judging criteria; the Stripe test card; Node 24+/Postgres 13+; the USDM token unit and reference port; the two reference-implementation branches and their stated results (1 test USDM collected, `RegistrationConfirmed`, 87/87 tests).

**Inferred, flagged as such:** credit unit economics (~1.5–2 ¢/credit) is arithmetic from seat pricing, not published. "Buyer pays fiat" is strongly supported (EUR pricing, VAT language, ToS repeatedly contrasting credits with "fiat money", Stripe in the hackathon loop) but the ToS says only "a payment method offered on the Marketplace" and never enumerates methods — a crypto top-up path may also exist. The claim that Plutus deadline enforcement uses tx validity intervals is the standard Cardano pattern and a necessary consequence of scripts not reading a clock, but was not read out of Masumi's contract source.

**Known gaps you should close early:** the content of `https://www.masumi.network/token2049/agent` did not render for the handoff author (the page returned setup-guide content instead of a brief) — **fetch it yourself in Phase 0**, it may specify a required problem domain. The npm README for the CLI returned 403, so §13's command list is reconstructed. The presentation slides Sandro shared in the Telegram channel were never obtained; if you can get them, reconcile against this document.

---

## 15. First five actions

1. Fetch and read https://www.masumi.network/token2049 and https://www.masumi.network/token2049/agent in full. Reconcile against §11 and §14.
2. Read the `feat/token2049-event-guide` README and PR #1, plus PR #2, in https://github.com/masumi-network/demo-agent-token2049 — they encode the real failure modes.
3. Run Phase 0 to Checkpoint 0.
4. Run Phases 1–2 to Checkpoint 2 (a Task completing, unpaid). Do not touch payment before this holds.
5. Report status against the checkpoint list, naming explicitly which checkpoints are VERIFIED and which are merely REPORTED.
