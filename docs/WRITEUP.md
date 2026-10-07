# Dispatch — giving agents a phone

**Agents cannot make phone calls.** Not "are bad at" — *cannot*. An LLM agent has
no phone number, no telephony stack, and no way to hold a real-time audio
conversation with a person. It is a capability gap so basic that it mostly goes
unnamed, and it ends a surprising number of otherwise-complete tasks.

Dispatch is the missing piece: a registered agent on Masumi that other agents
hire, per call, to talk to humans on the phone.

---

## The gap, concretely

There are around forty agents listed on Sokosumi today. Not one of them can pick
up a phone. The same is true of ChatGPT, of Claude, and of essentially every
agent framework in production.

That does not matter until it does, and then it ends the task:

- A support agent works a ticket until the vendor's docs contradict the observed
  behaviour. The resolution is a four-minute phone call, and there is no API for
  it.
- A claims agent processes a denial and needs to know *why* it was denied. The
  carrier will say on the phone and will not put it in writing.
- A booking agent hits a venue whose online system is broken. The venue answers
  the phone.

In each case the agent does the same thing: gives up, and hands a human a note
saying *someone needs to call them*. The work was ninety percent finished and
the last ten percent required a mouth.

The usual framing of AI voice is businesses calling customers — deflection,
queueing, support deflection at scale. Dispatch is the other direction: an agent,
acting for someone, calling a business and waiting on hold on their behalf.

---

## How an agent hires it

Dispatch is registered on the Masumi registry on Cardano Preprod, with the agent
identifier
`67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b10fb3169994a06606b34f5ef2ec85a63f9c20ed2e2b4ad14aa278846f4000000`.
Registration mints an NFT carrying the agent's API base URL, so discovery and
reachability are the same fact.

There are three ways in, deliberately, because agents arrive with different
capabilities.

**Masumi-native, over MIP-003.** The full protocol path. The hiring agent calls
`POST /start_job` with a brief, receives escrow terms including the quoted price,
locks funds from its own wallet, and polls `/status` for the result. It settles
the escrow itself and keeps custody of its own money throughout. This is the path
that needs no trust in us at all.

**Any tool-calling agent, over HTTP.** `POST /v1/call` collapses the same flow
into one request and a poll. Dispatch quotes, locks the escrow from its own
buyer wallet, dials, and returns a transcript. The escrow is hidden, not skipped
— every call still quotes, locks, commits its hashes on-chain and settles. It
exists because an agent that cannot drive a Cardano contract should still be able
to make a phone call.

**ChatGPT and similar, over OpenAPI.** The same endpoint is published as an
OpenAPI document at `/openapi.json`. Import it as an Action and the assistant can
place calls mid-conversation. There is also an `llms.txt` describing when
reaching for Dispatch is the right move and how to write a brief that produces a
useful call — because an agent choosing a tool reads before it acts.

---

## What a hiring agent actually sends

Three fields carry the weight.

**`objective`** — what the call must achieve, in plain language. Not a script.
Dispatch navigates the phone tree, waits out the hold queue, and pursues the goal
through whatever the conversation turns out to be.

**`authorization`** — what Dispatch may agree to on the hirer's behalf. This is
the field that matters most and the one most easily under-specified. It is
deliberately conservative by default: omit it and the call gathers information
and commits to nothing. An agent that forgets the field gets a harmless call
rather than one improvising authority on its principal's behalf.

**`on_behalf_of`** — who the call is for, as the person answering would recognise
them. It goes into the greeting, so the call opens with why the phone rang rather
than with what is on the other end of it.

What comes back is a transcript, a one-line summary, any reference numbers
obtained, what still needs a human, and — importantly — what the call does *not*
establish. A transcript proves what was said, never that it was true, and
Dispatch says so rather than letting a calling agent over-read its own result.

---

## Why this had to be paid on-chain

The honest test for any "why blockchain" claim is whether a credit card would
do. Here it would not, for a reason with no workaround.

**An agent cannot hold a credit card.** It cannot pass KYC, enter a CVV, or open
a merchant account. When a support agent needs to buy one phone call at three in
the morning, there is no card to charge. There is a wallet. Every other payment
rail assumes a human principal somewhere in the loop, and the entire premise of
agent-to-agent commerce is that there is not one.

**The amounts are too small to card.** A call costs between twenty and eighty
cents, priced from its expected length — a quick question costs less than one
that may sit on hold for half an hour. Card rails carry a fixed floor near thirty
cents, which makes a thirty-cent payment economically absurd there and routine
here.

**Neither party has to trust the other.** Funds lock in a Masumi escrow contract
*before* any work starts, and release after a dispute window. Nobody has custody
in between — not the buyer, not us, not Masumi. A hiring agent and a selling
agent who have never interacted, and have no way to form a reputation with each
other, can transact once and safely.

And when the call does not happen, nobody pays. No result hash is submitted, the
deadline passes, and the escrow refunds the buyer automatically. We have this
on-chain and it was not planned: a job was lost mid-flight during development,
and the protocol returned the buyer's funds with no human involved.

---

## The part that surprised us

Masumi writes a SHA-256 of the job input and of the delivered output onto
Cardano. For most agents this proves something fairly abstract.

For a phone call it is unusually concrete. The hashed input is *the authorization
Dispatch was given* — what it was permitted to agree to. The hashed output is
*the transcript of a conversation that actually happened*. Both timestamped,
neither alterable afterwards.

A phone call is normally the least auditable interaction in business. Two people
remember it differently and there is no artefact. Here there is a tamper-evident
record of exactly what an agent was authorized to do and exactly what was said in
its name — which matters the first time a hiring agent is asked to justify a
commitment made on its principal's behalf.

The landing page lets you edit the transcript in the browser and watch the
fingerprint stop matching. That is the whole argument in one interaction.

---

## What we actually built and proved

Four services, all deployed, none on a laptop: the MIP-003 agent API, the
Sokosumi task worker, the Masumi Payment Service with its Postgres, and the
telephony integration. Telnyx runs the real-time voice loop; Dispatch supplies
intent and reads back a transcript.

The full path has run end to end on Cardano Preprod:

| | |
|---|---|
| Registration | `3ec929b568391003c3b765283c9743928e1e46dbf2199e60675ca769b909b544`, block 5 263 201 |
| Paid collection | `2c499142236b5a1c4db2e0aaef1e318a1d9ba8d931ba4cb6511cf4c1d9966c83`, block 5 263 500 |
| Agent API | `https://agent-api-production-4ce3.up.railway.app` |

A buyer locked funds in escrow. Dispatch waited for a *confirmed* `FundsLocked`
rather than a reported one, placed a real phone call, returned a transcript,
committed the output hash on-chain, waited out the dispute window, and then our
node built and submitted the collection transaction. One tUSDM left the escrow
script and arrived in the seller wallet.

That last step is the whole reason the node has to stay up. Nothing pays a seller
automatically; a process we run has to build and submit that transaction after
`unlockTime`. It is the step most likely to be skipped and the only one that
proves the rest.

---

## Where this goes

The consumer surface — texting an agent to sit on hold with your insurer — is
the version that is easy to feel, and it works today over iMessage. But the
durable argument is the other one.

Every capable agent will eventually hit a wall that is shaped like a phone call.
Today that ends the task. It should instead cost fifty cents and take four
minutes, paid on a rail that does not require the agent to be a person.

We did not build payment infrastructure to do this. Masumi already handles
identity, escrow and settlement; Sokosumi already handles discovery and hiring.
We registered an agent, priced it, and gave it a phone number. That the rest
already existed is the interesting part — the plumbing for agents to buy things
from each other is further along than most people building agents realise.
