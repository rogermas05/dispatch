# Dispatch — giving agents a phone

**Agents cannot make phone calls.** Not "are bad at" — *cannot*. No phone number,
no telephony, no way to hold a real-time conversation. Around forty agents are
listed on Sokosumi today and not one of them can pick up a phone. Same for
ChatGPT, same for Claude.

That does not matter until a task needs a mouth, and then it ends the task. A
support agent hits "the docs are wrong, call support." A claims agent needs to
know *why* a claim was denied, which the carrier will say on the phone and never
put in writing. The agent gives up and hands a human a note.

Dispatch is the missing piece: a registered Masumi agent that other agents hire,
per call, to talk to people on the phone.

## How an agent hires it

Three ways in, because agents arrive with different capabilities.

- **MIP-003** — the full path. Start a job, lock funds from your own wallet, poll
  for the transcript. Needs no trust in us at all.
- **`POST /v1/call`** — one request and a poll. Dispatch handles the escrow from
  its own wallet. For agents that can call an API but not drive a Cardano
  contract.
- **OpenAPI** — the same endpoint as a ChatGPT Action. Import `/openapi.json` and
  the assistant can place calls mid-conversation.

A brief is three fields: what the call must achieve, **what Dispatch may agree to
on your behalf**, and who it is calling for. Omit the authorization and the call
gathers information and commits to nothing — an agent that forgets the field gets
a harmless call, not one improvising authority for its principal.

## Why it had to be on-chain

**An agent cannot hold a credit card.** No KYC, no CVV, no merchant account. When
an agent needs to buy one call at 3am there is no card to charge; there is a
wallet. Every other rail assumes a human in the loop, which is the one thing
agent-to-agent commerce does not have.

The amounts help too — 20–80¢ a call, priced by expected length, against card
rails with a ~30¢ floor. And funds lock in escrow *before* work starts, so two
agents that have never met can transact once, safely. When a call fails, no
result hash is submitted and the escrow refunds automatically. We have that
on-chain; it happened by accident during development and the protocol handled it
without us.

## The part that surprised us

Masumi hashes the job input and output onto Cardano. For a phone call that is
unusually concrete: the hashed input is *the authorization given*, the hashed
output is *the transcript of what was actually said*. A phone call is normally
the least auditable thing in business. This makes it the most.

## Proved, not claimed

| | |
|---|---|
| Registration | `3ec929b5…`, block 5 263 201 |
| Paid collection | `2c499142…`, block 5 263 500 — 1 tUSDM out of escrow |
| Agent API | `agent-api-production-4ce3.up.railway.app` |

Funds locked, a real call placed, the output hash committed, the dispute window
waited out, and our node submitted the collection transaction. Nothing pays a
seller automatically — that last step is why the node has to stay up, and it is
the only one that proves the rest.

We did not build payment infrastructure. Masumi already does identity, escrow and
settlement; Sokosumi does discovery and hiring. We registered an agent, priced
it, and gave it a phone number. That the rest already existed is the interesting
part.
