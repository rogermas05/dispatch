# Dispatch — submission artifacts

Generated 2026-10-07T07:11:14.240Z from `.local/` evidence and live chain queries.

Every claim is **VERIFIED** (we measured it) or **REPORTED** (a service told us).
A Sokosumi task marked `COMPLETED` is REPORTED payment, not verified payment —
the product layer completes immediately while the chain settles later. Only a
confirmed collection transaction counts, and it is queried from Blockfrost
directly rather than taken from the payment service.

## 1. Code

Repository: https://github.com/rogermas05/token-origins

Configuration and run instructions: [`README.md`](../../README.md) ·
[`docs/ONBOARDING.md`](../ONBOARDING.md) · [`docs/DEPLOY.md`](../DEPLOY.md)

## 2. Agent

| | |
|---|---|
| Name | Dispatch |
| Deployed agent URL | https://agent-api-production-4ce3.up.railway.app |
| Coworker ID | 01a11058-0fba-71dc-a1b9-acd31d538001 |
| Vendor ID | 01a10fd1-9907-77ba-92d0-ac202cedd643 |
| Agent identifier | `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b10fb3169994a06606b34f5ef2ec85a63f9c20ed2e2b4ad14aa278846f4000000` |
| Policy ID | `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b` |

**VERIFIED** — `GET /availability` returns 200 from the public internet.

## 3. Registration (Checkpoint 3)

| | |
|---|---|
| State | RegistrationConfirmed |
| Transaction | `3ec929b568391003c3b765283c9743928e1e46dbf2199e60675ca769b909b544` |
| Block | 5263201 |
| Explorer | https://preprod.cardanoscan.io/transaction/3ec929b568391003c3b765283c9743928e1e46dbf2199e60675ca769b909b544 |

## 4. Completed task (Checkpoint 2)

| | |
|---|---|
| Sokosumi Task ID | `01a11125-032f-7686-98cb-fcf84bcc4767` |
| Status | COMPLETED |
| Credits | 0 |
| Start event | `—` |
| Complete event | `01a11125-363a-7649-8f44-3cc8d8b563b6` |

Run with the mock provider: this checkpoint proves the task pipeline, not telephony. Real call capability is proven separately in checkpoint-2t.json. The mock states in every transcript that no call was placed, and the agent correctly reported the objective as unmet rather than fabricating an outcome.

## 5. Real phone call (Checkpoint 2T)

| | |
|---|---|
| Conversation | `e4717f03-57a0-4a7a-ba31-dfa17deaa871` |
| Turns | 10 |
| Connected | true |
| Opening line | "Hello, I am an AI assistant calling on behalf of a customer." |

Placed to a consenting operator-owned handset. The agent identified itself as an
AI unprompted.

## 6. Seller payment proof (Checkpoint 4)

| | |
|---|---|
| Network | Cardano **Preprod** |
| Seller address | `addr_test1qpljsrcjcqusr3pl2jcuz38yl5csgw5sc682hahqqp38pf6y4u32x337mw322lqsatzmlc32kekk6rscktudu99rdz6sflargg` |
| Test USDM unit | `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d` |
| Current balance | 101000000 tUSDM, 97418921 lovelace |

**VERIFIED — confirmed collection transaction**

| | |
|---|---|
| Transaction | `2c499142236b5a1c4db2e0aaef1e318a1d9ba8d931ba4cb6511cf4c1d9966c83` |
| USDM received | 1000000 (1 tUSDM) |
| Block | 5263500 |
| Time | 2026-10-07T07:10:14.000Z |
| Explorer | https://preprod.cardanoscan.io/transaction/2c499142236b5a1c4db2e0aaef1e318a1d9ba8d931ba4cb6511cf4c1d9966c83 |

## 7. Presentation

Slides (.ppt or .keynote via Google Drive, demo recording **embedded in the
file** — external links are not accepted): _to be added_.
