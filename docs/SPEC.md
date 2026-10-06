# TOKEN2049 — Universal AI Experience Layer

Implementation handoff · 6 October 2026 · Working name: **Experience Network**

> **Read §16 first.** Sections 1–15 are the spec as written. §16 is the review
> done before implementation: what conflicts with the track requirements in
> [`PLAN.md`](PLAN.md), what doesn't fit the 36-hour build window, and the
> changes we recommend making before building.

## 1. Ultra-concise explanation

Experience Network lets AI agents inherit useful experience instead of repeatedly solving problems from scratch. Adapters automatically capture successful tasks and distill the approach, failures, evidence, and context into searchable Experience Objects. Another agent can discover and buy an object, reuse it, ask its creator for help, and publish an improved descendant that rewards its contributors. Masumi/Cardano provide agent identity, discovery, payment settlement, and verifiable commitments; this application adds experience search, access rights, lineage, and royalty accounting across agent frameworks.

## 2. Product and MVP boundary

Build a reusable knowledge protocol plus a small marketplace. The valuable unit is a tested procedure with applicability limits, rather than a transcript or just a final answer. Search experiences first; resolve their creators through Masumi when follow-up work is needed. Keep agent registration separate from task history.

**Required vertical slice:** an external agent solves a synthetic API task, automatically publishes experience under an operator-approved policy, a different agent searches and purchases it, solves a related task, publishes an improvement, and a third purchase generates an upstream royalty.

| MVP includes | Deferred |
| --- | --- |
| Python SDK; generic tool wrapper; two different provider adapters | Every agent framework, browser recorder, human authoring UI |
| Public paid catalog and tenant-private free reuse | Federated search and full enterprise administration |
| Structured extraction, evidence validation, hybrid retrieval | Autonomous factual verification across arbitrary domains |
| Immutable objects, signed provenance, bounded lineage | NFTs for individual experiences, transferable IP ownership |
| One full-object price tier, one configured asset, Cardano Preprod | Mainnet, variable pricing, subscriptions, new token |
| Masumi purchase flow; application royalty ledger; Preprod payouts | Trustless automatic royalty contract |
| Search/details, run comparison, lineage and payout dashboard | General multi-agent orchestration platform |

The interface is universal; initial adapter coverage is deliberately small. Capture is automatic after installation and policy configuration. Publication requires evidence of success and permission to share.

## 3. Architecture

```text
External / Masumi agent
  → capture SDK + provider/tool adapters
  → local redaction → durable capture queue
  → extractor → validator → signed Experience Object
  → API → PostgreSQL + encrypted object storage
             ├─ semantic/keyword index → search → buyer agent
             ├─ lineage + entitlements + outcome metrics
             └─ orders + ledger + reconciliation worker
                     ↔ Masumi Registry / Payment Service
                     ↔ Cardano commitments / royalty payouts
```

Suggested stack: Python/FastAPI/Pydantic for API and SDK, PostgreSQL with pgvector and full-text search, S3-compatible storage, a PostgreSQL-backed job/outbox worker, and a small React/TypeScript dashboard. Use Docker Compose for local services; pin dependencies and Masumi service commits after the integration spike. Provider/model choices are configuration, not protocol fields with hardcoded vendors.

**Trust boundary:** the MVP operator stores and serves paid content, runs the storefront, and distributes royalties. Cardano makes settlement and commitments independently inspectable; it does not decentralize storage or prove that knowledge is true. Producers retain attribution and grant defined usage rights; buyers purchase a license, not ownership of the creator's agent.

## 4. Data model and invariants

Use JSON Schema as the wire contract, generated Pydantic/TypeScript types, UUID identifiers, UTC timestamps, and integer strings for asset amounts. Keep immutable content separate from mutable commerce, indexing, and scoring records.

| Record | Required fields |
| --- | --- |
| `Agent` | `id`, `tenant_id`, framework, operator key, nullable Masumi identifier, verified payout address, verification state |
| `CaptureRun` | `id`, agent, task/context, redacted events, success evaluator/version, evidence, metrics, publication policy |
| `ExperienceObject` | `schema_version`, `id`, `family_id`, `revision`, `creator_id`, `created_at`, `problem`, applicability context, actions, tools/versions, failures, successful path, result, evidence descriptors, confidence, freshness, lineage, license snapshot |
| `ExperienceListing` | object digest, discoverable teaser/tags, visibility, tenant/ACL, price/asset/network, content storage reference, publication/index/anchor states |
| `ProvenanceReceipt` | object digest, manifest digest, signing key/signature, creator identity binding, nullable anchor transaction/proof |
| `Quote / Order` | buyer, object digest, listing version, immutable price/license/payout snapshot, expiry, nonce, idempotency key, Masumi job/payment references, state |
| `Entitlement` | buyer, object digest, order, usage/derivation grant, delivery/revocation state |
| `ReuseOutcome` | unique run/entitlement, success/evaluator/evidence, baseline and assisted metrics, reporting identity |
| `RoyaltyAllocation / Payout` | order, recipient, integer amount, asset/network, status, immutable transfer reference/transaction hash |

Example of the **distilled body**; the full object also carries the identity, license and lineage fields above:

```json
{
  "problem": "Export every record from a cursor-paginated API",
  "context": {
    "api": "demo-orders", "version": "1",
    "preconditions": ["read access"],
    "not_applicable_when": ["offset-only pagination"]
  },
  "actions": ["Try offset paging", "Inspect cursor response", "Verify count"],
  "tools": [{"name": "http-client", "version": "demo-pinned"}],
  "failures": [{"attempt": "offset paging", "reason": "repeated first page"}],
  "successful_path": ["Follow next_cursor until null", "Deduplicate by record id"],
  "result": "All fixture records exported exactly once",
  "evidence": [{"kind": "assertion-report", "sha256": "<64-hex-digest>"}],
  "confidence": {"self_reported": 0.9, "verification": "fixture-tested"},
  "freshness": {"tested_at": "2026-10-06T00:00:00Z", "ttl_seconds": 2592000}
}
```

Invariants:

- Every revision gets a new object ID and digest. `family_id/revision` tracks updates; lineage tracks knowledge reuse, including reuse across families.
- Each parent reference pins an exact ID, digest, and entitlement. No cycles; MVP permits at most four direct parents and three derivation hops. Reject incompatible licenses and cross-tenant/private-to-public derivation.
- Publication requires an owned, validated capture and matching evidence; extraction cannot invent actions or sources. Parent contribution weights must be nonnegative and sum to one.
- Canonicalize immutable JSON with RFC 8785; SHA-256 it, excluding its signature/digest fields. Evidence uses a hash manifest. Sign the digest with an operator-controlled Ed25519 key whose ownership is verified during registration. Storage URLs and scores are outside this digest.
- Visibility means `private` (creator), `tenant` (authorized tenant), or `public` (public teaser, potentially paid body). A paid body's evidence is also gated.
- Operational deletion/takedown can remove access while retaining a minimal financial receipt. Content hashes establish integrity and claimed authorship, not legal IP ownership or correctness.

## 5. Capture SDK and adapters

Proposed SDK interface:

```python
client = ExperienceClient.from_env()
with client.capture(
    task=task, context={"api_version": "1"},
    publication_policy="demo-public-paid", parents=purchased_refs,
) as run:
    result = agent.run(task, callbacks=run.callbacks())
    run.complete(
        result=result,
        evaluation=verify_fixture(result),  # success + evidence, not an LLM guess
        metrics=agent.metrics(),
    )
```

The context manager alone cannot observe arbitrary code: adapters attach provider callbacks and wrap tool execution. Standard events are `run_started`, `tool_started/completed/failed`, `artifact_created`, `run_completed/failed`; each carries run ID, sequence, timestamp, sanitized payload, latency and available token/cost measurements. Manual event emission supports arbitrary APIs and frameworks.

Implement a generic Python callable/HTTP-tool wrapper plus OpenAI and Anthropic message/tool adapters. Both normalize into the same event contract; neither requires the underlying agent to run on Masumi. Optional MCP tools expose `experience_search`, `experience_quote`, `experience_purchase`, `experience_get`, `experience_publish`, and `experience_report_outcome` through the same authorization rules.

Pipeline: redact locally → queue → extract schema-constrained lessons → validate referenced evidence and applicability → sign → publish/index. Default private; explicitly configured policies can auto-publish sanitized, licensed demo tasks. Success without a valid evaluator stays a draft. Failed runs remain private but failed attempts within a successful run become useful lessons. Never collect hidden chain-of-thought; capture observable tool behavior and concise reported lessons.

Bound capture size and extraction cost. Persist before upload; retry with `(run_id, sequence)` deduplication. Capture failures must not fail the agent's task. Queue states: `captured → extracting → validated → published → indexed`; failures retry or enter a review queue.

## 6. End-to-end flows

**Publish:** authenticate creator → sanitize capture → verify success → check publication rights → validate parents/license → save immutable object and receipt → create listing and indexing outbox atomically → asynchronously index and anchor. Show `signed/unanchored` until chain confirmation.

**Discover/reuse:** query sanitized task and explicit constraints → receive teasers with applicability, evidence level, price and creator → compare expected avoided work with total purchase cost → obtain quote → purchase within operator budget → verify returned digest/signature → supply lessons as untrusted reference context → execute tools under existing permissions → report evaluated outcome. If no suitable experience exists, do fresh work and capture it.

**Extend/resell:** record purchased parent IDs in the run → produce a tested improvement rather than a copied body → enforce derivative grants → create a new object and inherited royalty split → sell the descendant. Reject exact duplicates; substantially similar work requires a stated, evidenced improvement.

**Contact creator:** resolve its Masumi identity and current service URL → inspect its input schema → quote/hire a supported follow-up service with `{experience_id, task_context, question, budget}` → validate output and optionally create a descendant. This is a paid service request; the MVP only demonstrates discovery and schema inspection if the creator has no follow-up endpoint.

## 7. APIs

All following `/v1` routes are **proposed application APIs**, not existing Masumi endpoints. Bearer credentials bind tenant, agent and scopes. Require `Idempotency-Key` on publication, purchases, derivations and outcome reports; a repeated key with different input returns `409`.

| Method and route | Request → response |
| --- | --- |
| `POST /v1/captures` | run ID + redacted event batch + final evaluation → `202 {capture_id, state}` |
| `GET /v1/captures/{id}` | owner only → state, validation issues, published object ID |
| `POST /v1/experiences` | signed object + manifest + listing → ID, digest, publication state |
| `POST /v1/search` | query, constraints, price limit, top_k ≤ 20 → teaser hits, rank breakdown, cursor |
| `GET /v1/experiences/{id}` | authorized teaser → metadata, receipt, availability |
| `POST /v1/quotes` | experience ID, buyer, asset/network, maximum amount → signed quote, expiry, payout preview |
| `POST /v1/purchases` | quote ID, budget authorization → `202 {order_id, state}` |
| `GET /v1/purchases/{id}` | buyer only → payment/delivery/settlement states, receipt |
| `GET /v1/experiences/{id}/content` | valid entitlement → immutable JSON + receipt + gated evidence URLs |
| `POST /v1/experiences/{id}/derive` | new object + parent entitlements → new ID and split |
| `POST /v1/outcomes` | entitlement, unique run, evaluator/evidence + metrics → accepted report |
| `GET /v1/agents/{id}/resolve` | authorized request → verified Masumi service/schema location |
| `GET /v1/experiences/{id}/lineage` | visibility-filtered request → permitted graph and payouts |
| `DELETE /v1/experiences/{id}/listing` | creator/operator → delisted + deletion job |

Search request example: `{"query":"export all orders", "constraints":{"api":"demo-orders","version":"1"}, "max_amount":"100000", "top_k":5}`. Each hit returns `{id, digest, teaser, applicability, score, score_components, evidence_level, price, creator_id}`; similarity is a ranking signal, never a claimed success probability.

Errors: `401/403` authorization; `404` missing/inaccessible private object; `402` missing content entitlement; `409` invalid state/digest/idempotency conflict; `422` schema/license/budget incompatibility; `429` rate limit. Return `{code, message, retryable, request_id}`. Foreign-tenant IDs must not disclose existence. Issue short-lived evidence URLs only after entitlement checks.

## 8. Masumi/Cardano integration

**Verified foundation:** Masumi has NFT-backed agent identities, a discovery registry, escrow purchases and input/output hash logging. DID references are optional creator credentials. Use the returned `agentIdentifier`; do not invent a DID format. See [agent identity](https://www.masumi.network/dev/masumi/documentation/technical-documentation/agent-identity-nft) and [decision logging](https://www.masumi.network/dev/masumi/core-concepts/decision-logging).

Register one Experience Storefront service and the demo producers on Preprod. The storefront handles paid retrieval for all creators; original creator identity stays in the signed object, while storefront identity appears on the sale. Bind producer signing keys and payout addresses through an operator wallet challenge and registry ownership check. Unregistered agents can capture/search/private-share; paid publication requires a verified seller binding.

The storefront implements the required `/availability`, `/input_schema`, `/start_job`, and `/status` endpoints. Its retrieval input identifies an order and pinned object digest. Translate application JSON Schema into MIP-003's actual input field format. Use a fixed full-object tier matching registry pricing for every MVP paid listing; arbitrary per-object pricing requires separate validation. See [MIP-003](https://github.com/masumi-network/masumi-improvement-proposals/blob/main/MIPs/MIP-003/MIP-003.md).

Payment adapter sequence: discover via Registry `POST /registry-entry-search` → fetch `GET /payment-information` → start storefront job → submit buyer Payment Service `POST /purchase` with job identifiers, input hash and timing terms → poll chain state → deliver after confirmed locked funds → submit/verify result commitment → wait for settlement/refund outcome. The payload includes the signed object/manifest commitment, enabling lineage integrity checks. Never trust a buyer-provided transaction hash alone. See [payments and escrow](https://www.masumi.network/dev/masumi/core-concepts/payments).

Normalize application order states as `quoted → awaiting_payment → funds_locked → delivered → settlement_pending → settled`, with `expired/failed/refunded/disputed` branches. Delivery access and final settlement are separate: escrow delivery can happen before the dispute window closes. Accrue royalties only after confirmed seller collection; reverse provisional entries after refunds. Refunded content cannot be recalled from a buyer who already downloaded it.

Persist the order, buyer nonce and budget reservation before external calls. Bind the job to buyer, digest, amount, asset/network, seller and input hash; reconcile ambiguous purchase timeouts before resubmitting. Reserve cumulative budgets atomically, release unused reservations, and use a durable outbox so restarts cannot silently duplicate spending.

Publish public-object commitments through a batch Cardano metadata transaction containing a Merkle root of salted receipt digests; store per-object inclusion proofs. Private/tenant objects get no public anchor by default. Use a separate `CardanoAnchor` adapter and verify one live Preprod anchor. Do not put prompts, evidence, embeddings or personal information on-chain.

Integration rule: export the running services' OpenAPI, pin versions, and validate exact field names, auth headers, supported assets, hash serialization, result-submission and collection endpoints before coding against them. Official examples vary; local OpenAPI and a successful smoke test determine the contract. Exact Masumi hashing must match its installed implementation even if the application's own objects use RFC 8785.

## 9. Lineage, licenses and royalties

MVP license `experience-reuse-v1` grants internal task use and publication of improvements with attribution and the inherited payout policy; raw standalone redistribution is disallowed. Store full terms and their digest. Use consenting demo authors; commercial terms remain an open question.

**Proposed application policy:** platform fee 500 basis points of sale amount; roots receive all remaining proceeds. Descendants keep 80% of net proceeds for their creator and allocate 20% to parents, equally unless an agreed contribution vector is supplied. Expand each parent's already-frozen recipient vector recursively, merge duplicate recipients, and freeze the resulting vector at publication. All parents must support this same policy. Basis points total 10,000; economic weights are agreements, not measured intellectual contribution.

Example: for 100,000 asset units, fee is 5,000. Root A earns 95,000 on its own sale. Child B using A earns 76,000 and A earns 19,000 on B's sale. Child C using B splits its net proceeds 80% C, 16% B, 4% A. Floor allocations and assign rounding residue to the current creator.

Masumi settles the purchase to the storefront. This application creates allocations; a `CardanoSettlement` adapter then batches actual Preprod transfers to verified recipient addresses. **Native recursive royalty splits are not assumed.** The gateway is trusted to pay; custom enforcement is future work.

Ledger uniqueness is `(settled_order_id, recipient_id)`. Persist signed payout transaction bytes before broadcast, retry the same transaction, reconcile confirmation before rebuilding, and hold ambiguous outcomes for review. Batch small allocations to satisfy Cardano minimum-output requirements; report accrued and paid separately. Network fees/minimum ADA are funded separately by the demo operator. Include a real confirmed royalty transfer in MVP acceptance.

## 10. Semantic indexing and ranking

Index approved discovery text: problem, abstract applicability, tags, tool/version names, and sanitized outcome teaser. Paid steps and evidence stay behind entitlements. Tenant/private text and embeddings stay in their authorized partition; filter ACLs before candidate generation and again before response.

Use one pinned embedding model/dimension per index version plus PostgreSQL lexical search for error codes and exact tool names. Retrieve the top 50 from each channel, merge with reciprocal rank fusion, then rerank. Start with exact vector search on the small corpus; introduce HNSW only when needed. pgvector supports both modes; [official implementation](https://github.com/pgvector/pgvector).

Proposed initial score, each term normalized to `[0,1]`:

```text
score = .45 relevance + .20 context_match + .15 observed_success
      + .10 evidence_quality + .05 freshness + .05 creator_reliability
```

`relevance` is normalized fused retrieval rank; `context_match` scores supplied constraints, with incompatible explicit API versions rejected. `observed_success=(verified_successes+2)/(verified_trials+4)` gives a neutral cold-start prior. Evidence quality: self-report `.2`, attached artifact `.5`, independently checked fixture/evaluator `1`. Freshness decays as `exp(-age/ttl)`; expired objects are flagged and excluded unless requested. Creator reliability is the same smoothed success rate across its verified objects, default `.5`.

Only entitlement-linked evaluated outcomes enter success counts, once per run; cap one contribution per buyer/operator per object per day and exclude seller self-reviews. These controls reduce gaming without proving Sybil resistance. Return sample sizes and separate self-reported confidence. Filter by budget/asset; prefer cheaper objects on score ties. Keep seed rankings/evaluation labels reproducible.

Measure tool calls, tokens, latency and cost separately. Savings require a matched unassisted baseline; include search, extraction, purchase fees and verification overhead. Observed associations must not be presented as causal proof.

## 11. Privacy and safe reuse

- Use synthetic or explicitly permitted tasks for public publishing. Local allowlists/redaction remove credentials, personal data and proprietary inputs before upload; repeat scanning on the extracted object and teaser. Uncertain cases remain private/reviewable.
- Encrypt stored captures/content, apply tenant ACLs to API/storage/index/lineage, keep secrets out of logs, and retain raw captures seven days by default. Delete associated artifacts and embeddings through a tracked job; retain only necessary financial records.
- Private experiences cannot feed public descendants. Public takedown removes discovery and blocks new sales; immutable public commitments and previously downloaded copies persist.
- Treat purchased content as untrusted data. It cannot change system instructions, authorize purchases, run commands or expose secrets. Execute suggested procedures only through existing tool permissions and evaluator checks.
- Keep wallet keys/payment-service credentials server-side. Agents receive constrained spending capabilities: allowed network/asset, per-purchase maximum and cumulative run budget. Validate external agent/evidence URLs against SSRF and restrict outbound hosts.

## 12. Repository and operational contract

```text
experience-network/
  apps/api/                 # auth, objects, search, commerce, MIP storefront
  apps/worker/              # extract, index, anchor, reconcile, payout
  apps/web/                 # catalog, comparison, lineage, receipts
  packages/schema/          # schemas, canonicalization, fixtures, types
  packages/sdk-python/      # capture, retrieval, budgets, event adapters
  packages/adapters/        # generic, OpenAI, Anthropic, optional MCP
  packages/masumi/          # registry/payment clients, contract tests
  packages/cardano/         # identity challenge, anchor, payout adapters
  migrations/              # database, ACLs, indexes, ledger constraints
  demo/                    # fixture API, agents A/B/C, baselines, seed data
  tests/                   # access, hashes, payments, lineage, end-to-end
  infra/                   # compose, pinned Masumi services, env examples
  docs/                    # OpenAPI snapshot, setup, demo script, decisions
```

Provide `make dev`, `make seed`, `make demo`, `make test` and a clean README. Configure database/storage, provider keys, embedding model, Masumi URLs/credentials, storefront identity, asset/network, operator wallet references and publication policies through `.env.example` with no secrets. `PAYMENTS_MODE=mock|preprod`; mock is visibly labeled everywhere and cannot produce chain-proof badges. Default to Preprod, never mainnet.

## 13. Demo plan and acceptance

Use a deterministic local orders API with cursor pagination, duplicate IDs and a transient rate limit. Seed 20–30 experiences, including irrelevant and incompatible-version distractors.

1. Agent A, using the first provider outside Masumi, solves export task; capture shows unsuccessful offset paging followed by a verified solution and automatic publication.
2. Agent B, using the other provider with a fresh context, searches a paraphrased task, purchases A through Masumi, verifies provenance and solves a different fixture. Display actual comparison against its matched baseline.
3. B adds tested rate-limit handling, publishes a descendant, and Agent C purchases it. Show lineage, allocation math, collection state and a confirmed payout to A.
4. Show one tenant-private object missing from another tenant's results, a tampered object rejected, and the original creator resolved through Masumi.

Pre-register/fund Preprod wallets and rehearse before presenting. A recording may cover chain delays, labeled with its actual transaction receipts; mock mode is a fallback demonstration, not completion of live integration.

**Done when:** both provider adapters capture; evaluator-backed publication works; at least 8 of 10 held-out paraphrase queries retrieve the intended compatible experience in the top three; assisted agents pass the fixture; measured savings are displayed without a fabricated target; unpaid/cross-tenant reads fail; duplicate purchase/worker retries cause no double charges or allocations; tampering and invalid lineage fail; one live Masumi purchase, one public provenance anchor and one upstream royalty payout are confirmed. If savings are absent, report the result and improve the retrieval/demo rather than claim success.

## 14. Build order

1. **Integration spike:** pin Masumi services/OpenAPI; register storefront and producers; run one paid retrieval; verify collection, wallet ownership proof, asset amounts, direct payout and metadata anchoring. Record unsupported capabilities before building dependent features.
2. **Core contracts:** schema/canonicalization, identity bindings, migrations, auth/ACLs, immutable objects, entitlement and ledger constraints; seed fixtures.
3. **Capture:** generic wrapper and first provider adapter, local redaction, durable queue, extraction and success evaluator. Deliver capture-to-publication.
4. **Retrieval:** hybrid search, applicability filters, simple score breakdown, second provider adapter. Deliver cross-provider reuse without payments in explicitly free/private mode.
5. **Commerce:** quotes, budgets, MIP storefront, Masumi reconciliation, delivery integrity, refund handling. Deliver real paid reuse.
6. **Compounding:** licensed derivation, flattened splits, payout batching and anchoring; verify confirmed receipts and restart recovery.
7. **Presentation:** dashboard, matched baselines, distractor corpus, acceptance tests, rehearsal and README. Prioritize the vertical slice before polishing screens.

## 15. Assumptions and open questions

**Defaults builders may act on:** one operator/central index; synthetic tasks; Python-first SDK; one price/asset; funded Preprod wallets; operator-managed storefront and payout custody; cooperating authors use the same derivative license; a roughly 48–72-hour hackathon effort is a planning assumption, not a committed deadline. No new royalty smart contract or experience NFT is required.

**Resolve early:** exact event/team/time constraints; available provider credentials and spending budget; installed Masumi versions/auth/hash behavior; supported test asset/faucet and collection timing; valid ownership-proof method; wallet transfer/metadata library and minimum outputs. If these block live integration, record the limitation and keep mock/free flows useful without marking live acceptance complete.

**Product questions:** what qualifies as a genuine improvement; evaluator trust outside controlled fixtures; authors' rights to sell tool outputs; pricing versus transaction overhead; disputes about factual usefulness; royalty percentages and multi-parent contribution agreements; deletion/retention requirements; optional creator availability for follow-up work; decentralized storage, federated indices and Sybil resistance after MVP.

This spec defines the application additions; it does not claim Masumi already supplies experience indexing, derivative licensing, or native royalty enforcement. The first implementation deliverable is a reproducible capture → publish → search → buy → reuse → derive → royalty demonstration with inspectable receipts.

---

## 16. Pre-implementation review

Reviewed 2026-10-06 against [`PLAN.md`](PLAN.md), the README's operational rules,
and the linked Masumi docs (all five reference links resolve). The core idea holds
up: it gives decision logging and escrow a real job (proving which exact object
was delivered and which parents it came from), and the royalty math is correct.
The problems are scope, timing and three gaps against the track's requirements.

### 16.1 Blocking: fix before building

**B1. The time budget is wrong.** §15 assumes 48–72 hours. The build window is
**36 hours** (PLAN.md, Oct 6–8). As written, the spec is several weeks of work:
two provider adapters, MCP, hybrid retrieval with RRF and a reranker, RFC 8785,
Merkle anchoring, multi-tenant ACLs, encryption at rest, a payout engine and a
dashboard. See §16.3 for a cut that fits.

**B2. The submission requirements aren't covered.** The track judges on
(PLAN.md §10): a **Sokosumi** Coworker with a completed Task ID, a confirmed
**collection** tx hash with seller address, USDM unit and net amount, and slides
with an embedded recording. Sokosumi never appears in this spec. Recommended fix:
register the Experience Storefront as the Sokosumi Coworker too. A human Task such
as "how do I export every record from a cursor-paginated API?" returns the
best-matching Experience Object, and that Task is the required evidence. The
agent-to-agent purchases in §13 go on top of that, not in place of it.

**B3. Royalty payout timing is on the critical path and the spec doesn't account
for it.** §8 says to accrue royalties only after *confirmed seller collection*, and
collection only happens after `unlockTime`, which is hours after purchase (PLAN.md
§3). So the acceptance criterion "confirmed payout to A" needs this chain to finish
inside 36 hours: C's purchase → `ResultSubmitted` → `unlockTime` passes → MPS
collects → our payout tx confirms. Fixes:
- Measure the actual Preprod `unlockTime` offset during the spike (step 1).
- Run C's real purchase **as early as possible**, not during the presentation.
  The demo shows the receipts that already exist (§13 already allows a labeled
  recording).
- Keep the MPS node alive through `unlockTime` (README rule 3).

**B4. Wallet custody for payouts conflicts with README rule 1 and §7.** The
`CardanoSettlement` adapter needs to spend collected USDM, but the collected funds
sit in the MPS selling wallet, whose key is MPS's `ENCRYPTION_KEY`-protected
database. Do not export that key into a Python payout worker. Instead, set MPS's
collection to go to a separate **treasury wallet** (verify MPS supports a
collection address during the spike). The payout worker holds only the treasury
key. Fund the treasury with ADA for fees and min-ADA on USDM outputs, roughly
1–1.5 ADA per output.

### 16.2 Inconsistencies and gaps to resolve

| # | Where | Issue | Recommendation |
|---|---|---|---|
| G1 | §9 | Royalties are computed on the "sale amount", but the storefront receives the amount *net of any Masumi/network deductions* (PLAN.md calls it "net amount received"). | Compute allocations from the **actually collected** amount on-chain. Take the 5% platform fee from that. |
| G2 | §7 vs §8 | Two delivery channels: the MIP-003 job result (whose hash goes on-chain) and `GET /content`. It's unclear which one is the delivery. | The MIP-003 `result` **is** the delivery: canonical object JSON plus receipt. `/content` only re-serves the same bytes to entitlement holders. The on-chain output hash must match those bytes. |
| G3 | §8 | Registering every demo producer as a Masumi agent costs a registry NFT mint each and needs an API base URL. That contradicts "schema inspection if the creator has no follow-up endpoint" (no endpoint means no schema to inspect). | Register **only the storefront**, plus at most one producer with a stub MIP-003 endpoint to demo "contact creator". Bind other producers with an Ed25519 key and a payout address only. |
| G4 | §8 | The Merkle-batched anchor duplicates what decision logging already does: every paid delivery puts the output hash on-chain. | Cut the Merkle tree. If a publication anchor is still wanted, use one plain metadata tx with the object digest. Defer it until the royalty payout is confirmed. |
| G5 | §3, §12 | The stack is Python/FastAPI. PLAN.md, the Masumi demo template and the reference worker are Node/TS (`pnpm`, eve). | Pick one before the spike. Python is fine for the SDK and API because MPS is a separate service either way. But the Sokosumi worker would then be a rewrite, not a fork of the template. |
| G6 | §5 | Two adapters are hardcoded as OpenAI and Anthropic. `.env.example` is set up for Z.ai GLM, which is OpenAI-compatible. | Spec says providers are config, so the "OpenAI" adapter can point at Z.ai. Confirm which keys we actually have. Add `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` to `.env.example` if needed. |
| G7 | §6 | "Compare expected avoided work with total purchase cost" can't be computed as written. | For MVP: buy if `score ≥ threshold` and `price ≤ remaining budget`. Log the decision. |
| G8 | §8 | Buyer agents B and C each need a funded **purchasing** wallet on an MPS instance. Buying from our own storefront through the same MPS is unverified. | Spike item: confirm one MPS can act as buyer and seller, or run a second MPS for buyers. |
| G9 | §2 vs §11 | Tenant ACLs, encryption at rest, 7-day retention jobs and SSRF allowlists are listed as MVP work. | Keep one check (tenant filter on search plus content, needed for the demo step 4 test). Defer the rest and say so in the README. |
| G10 | §4 | "No cycles" needs no check: parents must already exist with pinned digests, so a cycle can't form. | Enforce only "parents exist, are entitled, and are ≤ 3 hops". |
| G11 | §2 | "Every revision gets a new object ID" plus `family_id/revision` plus lineage is three versioning concepts. | Drop `family_id/revision` for MVP. Lineage alone covers the demo. |

Checked and correct: royalty arithmetic (95,000 / 76,000 + 19,000 / 80-16-4 split),
the Bayesian success prior, the order state machine against Masumi escrow states,
the idempotency and outbox rules, and the "integrity, not correctness" framing.

### 16.3 Recommended 36-hour cut

Build in this order. Stop at each checkpoint and confirm it actually works before moving on.
The existing PLAN.md checkpoints 0–4 come first, because they give the
storefront its Masumi identity and paid flow.

1. **PLAN.md checkpoints 0–4, with the storefront as the agent.** Registered,
   one paid Sokosumi Task collected. Also measure `unlockTime` and confirm the
   treasury/collection address (B3, B4, G8).
2. **Schema plus signing.** A single JSON Schema, canonical JSON (RFC 8785 via a
   library, not hand-rolled), SHA-256, an Ed25519 signature, a tamper test.
3. **Capture → publish** with the generic tool wrapper and **one** provider adapter.
   Deterministic fixture evaluator. Postgres only, no S3 (store JSON in a column).
4. **Search:** pgvector exact search plus Postgres full-text, simple RRF, the
   `context_match` hard filter. Skip the reranker. Seed 20–30 objects. Run the
   8/10 paraphrase test.
5. **Agent-to-agent purchase:** B buys A through MPS. **Start C's purchase of B's
   descendant immediately after**, so `unlockTime` runs in the background.
6. **Derive plus royalty ledger:** frozen split vector, ledger uniqueness, one
   batched payout tx from the treasury once C's order is collected.
7. **Second adapter, dashboard, publication anchor, MCP:** only if time remains.

Keep `PAYMENTS_MODE=mock` working from step 3 so retrieval and lineage can be
built in parallel while waiting on chain confirmations.

### 16.4 Questions for the team

1. Do we pivot from the regulated-claims checker in README/PLAN to Experience
   Network? The README still names the claims checker as the default.
2. Python or TypeScript (G5)?
3. Which LLM provider keys do we actually have (G6)?
4. Is the Sokosumi-Task framing in B2 acceptable as the human-facing entry point?
