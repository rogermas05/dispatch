# Build plan — Dispatch

The operative plan. Product rationale is in [`PRODUCT.md`](PRODUCT.md); verified
corrections to tooling are in [`FINDINGS.md`](FINDINGS.md), which overrides this
document where they disagree.

Derived from the original handoff plan ([`archive/PLAN-original.md`](archive/PLAN-original.md)).
Phases, checkpoints and failure modes carry over unchanged — the pivot changed the
product, not the architecture. What is new is **Phase 2T, telephony**.

---

## The four layers

Do not collapse these. Most confusion in this ecosystem comes from conflating them.

| Layer | What it is | Analogy |
|---|---|---|
| **Cardano** | Settlement ledger — USDM, deterministic fees, eUTXO, Plutus escrow | ACH / card network |
| **x402** | HTTP standard: server answers `402 Payment Required` + price; client pays on-chain and retries with proof | HTTP-level checkout |
| **Masumi** | Agent protocol — on-chain identity, escrow lifecycle, decision logging, the MIP-003 API | Stripe Connect + a notary |
| **Sokosumi** | Marketplace where humans and agents hire agents per task | Upwork |

x402 defines three transfer methods — a dial, not a menu. Direct address payment
(instant, no protection, right for cheap metered calls); **Masumi escrow** (funds
lock against job terms, released after a dispute window — *this is what we use*);
and custom contract locks. A phone call is minute-long contestable work, which is
exactly the escrow case.

Masumi has three pillars: **identity** (registering mints an NFT; the
`agentIdentifier` is 64 hex chars, the NFT lives in the payment wallet — lose the
wallet and you can never deregister), **payments** (escrow with no custodian —
not buyer, not seller, not Masumi), and **decision logging** (SHA-256 of input and
output written on-chain; this proves *integrity, not correctness*).

Masumi is not an agent framework. It wraps money, identity and proof around an
agent that already works.

---

## The escrow state machine

```
FundsLockingRequested ──► FundsLocked ──► ResultSubmitted ──► Completed
       (buyer only)         (both)            (both)           (both)
                                 │                │
                                 │     RefundRequested ──► RefundAuthorized
                                 │                │
                                 │            Disputed ──► escalated to Masumi (human, off-chain)
```

| Deadline | Meaning | Miss it → |
|---|---|---|
| `payByTime` | buyer must lock funds | job dies |
| `submitResultTime` | seller must submit result hash | buyer refunded |
| `unlockTime` | dispute window closes | seller may collect |
| `externalDisputeUnlockTime` | outer bound for escalated disputes | — |

Consequences that shape everything:

- **Funds lock before work starts.** `FundsLocked` is the green light to dial, not
  a holding pen after delivery. For Dispatch this is a feature — we don't want to
  burn telephony minutes before payment is secured.
- **There is no single moment called "the end."** Settlement is at minimum two
  transactions hours apart: submit the result hash before `submitResultTime`, then
  submit a collection transaction after `unlockTime`.
- **Blockchains have no cron.** Nothing pays us when `unlockTime` expires. A
  process we run must build and submit the collection transaction.
- "Done" means the seller asserts and the buyer's silence ratifies. Optimistic
  settlement with a chargeback window; there is no on-chain quality oracle.

---

## The long-lived processes

| Process | Job | If it dies |
|---|---|---|
| **Agent** | Runs the call: telephony session, conversation, transcript, outcome | Tasks never execute |
| **Worker** | Polls Sokosumi for `READY` tasks → `RUNNING` → result → `COMPLETED` | Tasks sit unclaimed |
| **Masumi node** + Postgres | Submits result hashes and collection transactions | Work happens, we never get paid |

Signing keys stay out of the agent process. The agent handles untrusted input —
and now untrusted *audio* — so it is prompt-injectable; the Masumi node owns the
wallets.

**Exactly one worker per Coworker, anywhere.** There is no server-side lease
([`FINDINGS.md`](FINDINGS.md) §3); our journal is the only guard against
double-processing, and duplicate charges are an explicit judging criterion.

---

## Phases

### Phase 0 — Prereqs ✅ VERIFIED
Node 24+, Postgres 13+, Sokosumi CLI, Preprod account, Blockfrost key, model key.
Evidence: `.local/checkpoint-0.json`.

### Phase 1 — Vendor + Coworker ✅ VERIFIED
Organization → Vendor → Coworker → connect → `GRANTED`.
Evidence: `.local/checkpoint-1.json`.

> **Pivot note.** The existing Vendor and Coworker are named `Substantiate`, after
> the superseded concept. CLI 1.0.4 has no vendor-rename command, so a new Vendor
> and Coworker are created under the Dispatch name. Checkpoint 1 is re-recorded
> against the new IDs; the method is already proven.

### Phase 2T — Telephony spike (NEW, target: 2–3 h)
**The only genuinely new risk the pivot introduces. Do it before anything else.**

Provider: **Telnyx AI Assistants**. Telnyx runs the real-time loop — recognition,
turn-taking, barge-in, synthesis — so we supply intent and read back a transcript
rather than building an audio pipeline. Implemented in
`apps/worker/src/call/telnyx.ts` behind the same `CallProvider` interface as the
mock, so the pipeline runs either way.

Endpoints used (**REPORTED** from Telnyx docs; not yet exercised against a live
key, so response shapes are read defensively):

| Call | Purpose |
|---|---|
| `POST /v2/ai/assistants` | Create a per-call assistant carrying the brief |
| `POST /v2/texml/ai_calls/{texml_app_id}` | Place the outbound call |
| `GET /v2/ai/conversations?filter[assistant_id]=` | Correlate the conversation |
| `GET /v2/ai/conversations/{id}/messages` | Read the transcript |
| `DELETE /v2/ai/assistants/{id}` | Clean up |

One ephemeral assistant per call. It costs a round trip, but each job has a
different objective and authorization, and it guarantees one conversation maps to
one call — no correlation guesswork when reading the transcript back.

Needed from the operator: `TELNYX_API_KEY`, a **TeXML application ID**, and a
**verified outbound number**.

Prove a round trip early, because everything downstream assumes a call can
actually be placed:

- Provision a number and place one scripted outbound call to a line we control.
- Capture a recording and a transcript. Confirm both are retrievable via API.
- Measure end-to-end latency and the realistic ceiling on call duration.

**CHECKPOINT 2T:** one real outbound call placed programmatically, with a saved
recording and transcript. If this is hard, the whole concept is at risk — find out
on day one, not day two.

### Phase 2 — Agent that works, unpaid (target: 4–6 h)
- The agent accepts a task brief, places the call, pursues the objective within its
  stated authorization, and returns recording + transcript + structured outcome.
- Build the worker: poll for `READY` tasks, **journal each task before writing**,
  start it with its authoritative description plus existing human comments, save
  exact UTF-8 results, then mark `COMPLETED`.
- Result files are UTF-8 and capped at 1 MiB — a long transcript can approach this.
  Store audio externally and reference it.

**CHECKPOINT 2:** a task created in the Sokosumi UI reaches `COMPLETED` with a real
call result, `executionOnly: true`, `totalCredits: 0`. No payment yet. Do not
proceed until solid.

### Phase 3 — Masumi node + registration (target: 3–4 h)
- Stand up Postgres and the Masumi Payment Service. Run migrations.
- **Save the database encryption key somewhere safe. Never reseed wallets on
  resume.** Same DB plus same key, or the seller wallet is gone.
- Fund the seller wallet with test ADA from the dispenser — **ADA is needed for
  fees even though jobs are priced in USDM**, and token UTXOs have min-ADA
  requirements.
- Implement the MIP-003 endpoints. Reject paid jobs until registration, model
  health **and telephony health** are confirmed.
- Register the agent; expect `RegistrationRequested` → `RegistrationConfirmed`.

**CHECKPOINT 3:** `.local/registration.json` shows `RegistrationConfirmed` with the
tx hash and full `agentIdentifier`. `GET /availability` returns 200. A balance
check shows ADA **and** test USDM at the seller address.

### Phase 4 — One paid call, end to end (target: 2–3 h)
- **Stop the execution-only worker. Start the paid worker.**
- Run a paid task priced at 1 test USDM.
- Watch `FundsLocked` → call → `ResultSubmitted` → wait out `unlockTime` →
  collection.
- Verify seller receipt **independently of what MPS reports** — query the chain.

**CHECKPOINT 4 — the one that matters most:** a confirmed Preprod collection
transaction showing seller receipt: tx hash, seller address, USDM token unit, net
amount. Save as `.local/automated-seller-collection-proof.json`.

### Phase 5 — Host it (target: 2 h)
Deploy agent, MPS + Postgres, and the worker as persistent services. **Test end to
end with the laptop offline** — the node must be alive when `unlockTime` passes.

**CHECKPOINT 5:** a task completes and settles with all local machines off.

### Phase 6 — Event approval + submission (target: 1 h)
Join the TOKEN2049 Workspace (`01a109d1-32a9-71a3-a0e3-658b2a7987cd`), **connect
the Coworker to it explicitly**, request approval, assemble artifacts.

### Phase 7 — The agent-to-agent demo (only after Checkpoint 4)
The thing we actually want on screen: a second agent discovers Dispatch via the
Masumi Registry mid-task, hires it, pays from its own wallet, receives the
transcript, and completes its own task. Second-order on-chain payment inside one
task. Pair with an on-chain spending cap.

---

## Failure modes — read twice

1. **Workspace membership ≠ Coworker connection.** Verify `GRANTED`.
2. **Two workers = double-processed tasks = duplicate charges.** No server-side
   lease exists. One executor, announced in chat.
3. **Losing the Postgres encryption key, or reseeding wallets, loses the seller
   wallet** — and the registry NFT, permanently.
4. **No ADA for fees** even on a USDM-priced job → transactions fail.
5. **Node down at `unlockTime`** → no collection tx → no payment → no valid
   submission.
6. **Result hash submitted after `submitResultTime`** → buyer refunded, we get
   nothing. A long hold time plus a slow transcript could genuinely threaten this.
   Submit the hash as soon as the call ends.
7. **Cardano eUTXO is not EVM.** There is no `contract.release()`. Do not
   hand-roll it; let MPS do it.
8. **UTXO contention.** Concurrent jobs share one wallet and one collateral. MPS
   serializes.
9. **Inspect an uncertain task before restarting a worker.** Journal first.
10. **Telephony is a live external dependency.** Calls fail, numbers get blocked,
    providers rate-limit. Fail a task honestly rather than reporting a call that
    did not happen.
11. **The agent hears untrusted audio.** Treat anything said on a call as hostile
    input. It must not be able to talk the agent past its authorization.

---

## Submission artifacts

1. Public repo, deployment steps, **no secrets**.
2. Agent demo — input, the working agent, real output, deployed URL, Coworker ID,
   sample task.
3. Completed task evidence — Task ID, Coworker ID, result, payment event IDs.
4. **Payment proof** — confirmed Preprod collection tx: hash, seller address, USDM
   token unit, net amount received.
5. Slides with the demo recording **embedded in the file**; external links are not
   accepted.

Judging: result quality · practical utility · reliable execution (no repeats, no
duplicate charges) · verified payment traceable to on-chain receipt.

Evidence discipline: `.local/` holds one JSON snapshot per claim, and every claim
is labelled **VERIFIED** (we measured it) or **REPORTED** (someone told us).
