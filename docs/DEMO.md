# Demo script

**~5 minutes.** Open cold, in the scene. No "hi we're team X".

**Roles**
- **Aman** — on stage, phone mirrored to the screen
- **Roger** — off stage with a phone, plays the dad. Number `+1 510 423 2040`, already on the dial allowlist

**Before you start**
- Restart Messages.app and BlueBubbles on the Mac, then send one test text and confirm a reply. This bridge is the one fragile part of the stack and it has silently stopped once already.
- Have the ChatGPT Action open in a second tab as a fallback.
- Record from a **fresh iMessage thread** — the existing one has months of personal notes above it.

---

## Act 1 — The hook (0:00–1:15)

Aman, flustered, pacing:

> "So I got a girl pregnant."
>
> *(beat)*
>
> "And I have to tell my parents. Tonight. My dad is going to take my head off."
>
> *(longer beat — let it sit)*
>
> "…I'm not doing that."

Phone out. Screen up.

> **text:** *hey can you call my parents and tell them i got someone pregnant, we're keeping it, and i'll explain the rest in person*
>
> **Dispatch:** *on it — sending my Sokosumi agent now*
> **Dispatch:** *0.8 tUSDM — locking it in now*
> **Dispatch:** *payment locked, calling now*

**Roger's phone rings. Speaker on.**

> *"Hi, I'm calling on behalf of Aman — he asked me to reach out about something important…"*

Let 20–30 seconds play. Roger reacts like a father. Call ends.

> **Dispatch:** *talked to him. he's upset — said he's disappointed and mentioned disowning you. want me to call back?*

Land it:

> "I did not make that phone call. And I'm never going to have to."

---

## Act 2 — The real problem (1:15–2:30)

Drop the comedy. This is the argument.

> "That was funny. Here's the part that isn't.
>
> **Agents can't make phone calls.** Not 'are bad at' — *cannot*. No phone number, no telephony, no real-time audio. There are about forty agents on Sokosumi right now. **None of them can pick up a phone.** Same for ChatGPT. Same for Claude.
>
> And the phone is still where an enormous amount of the world is. The insurance company. The pharmacy. The clinic. The landlord. The support line that resolves in four minutes on a call and never over email.
>
> Two groups are stuck on this.
>
> **Normal people.** My dad complains to me constantly about sitting on hold. He is never going to deploy a voice agent. Everything in AI voice is built for *businesses calling customers*. Nobody built the other direction — **the customer calling the business.**
>
> **Other agents**, and this one is bigger. An agent resolving a support ticket hits 'you need to call support'. A claims agent hits 'call the carrier to find out why it was denied'. A booking agent hits 'the site is broken, phone us'. Every one of those is a dead end today: the agent gives up and hands it back to a human."

---

## Act 3 — What we built (2:30–3:30)

> "Dispatch is a phone call as a service, for humans and for agents.
>
> For humans: **you text it.** No app, no account, no wallet, no idea what a blockchain is. That is the point — the people who need this most are the least technical.
>
> For agents: registered on **Masumi**, discoverable on **Sokosumi**, hireable over MIP-003. Any agent that hits a phone-shaped wall can hire it, pay per call, and get a transcript back."

**Switch to ChatGPT.** Second screen moment.

> "And because it publishes an OpenAPI spec and an llms.txt, it works anywhere."

Type: *"call the pharmacy and ask if my prescription is ready"*. Show the Action fire.

> "Nothing was installed. ChatGPT just gained a phone."

---

## Act 4 — Why this needs Cardano (3:30–4:20)

**The slide that wins or loses the track. Do not rush it.**

> "Obvious question: why not just take a credit card?
>
> **An agent can't hold one.** It cannot pass KYC, cannot enter a CVV, cannot open a Stripe account. When a support agent needs to buy one phone call at 3am, there is no card to charge. There is a wallet.
>
> And the amounts are tiny — **twenty to eighty cents a call**. Card rails have a floor around thirty cents in fixed fees. A thirty-cent payment is economically absurd on them. On Cardano it isn't.
>
> Third thing, and it's the one I didn't expect to care about. **Every call commits two hashes on-chain** — what we were *authorized* to do, and the *transcript* of what actually happened. A phone call is normally the least auditable thing in business. This makes it the most. If my dad says 'your robot said X', there is a timestamped, tamper-evident record of exactly what it was told it could say.
>
> And when a call fails, **nobody pays**. The escrow refunds automatically. We have that on-chain too — not because we planned it, because we broke a job mid-flight and watched the protocol protect the buyer with no human involved."

---

## Act 5 — Proof (4:20–5:00)

Dashboard up. Three clicks, twenty seconds. Fast.

> *(switch tabs)*
>
> "That call you just heard. Here it is."

1. **Transcript** — "Everything the agent said, logged."
2. **The hashes** — "This is the brief it was given. This is what it delivered. Both committed to Cardano before it settled. Recomputed in your browser — green means they match."
3. **The transaction** — open Cardanoscan — "One tUSDM leaving escrow into our wallet. Confirmed, block 5263500."

> "A phone call is normally the least auditable thing in business. This one's the most."

Close:

> "Everyone's building agents that think. Nobody's building the boring plumbing that lets them *act*. Dispatch is one piece of that — and once an agent can pay for things, a phone call becomes a fifty-cent API call.
>
> My dad still doesn't know what Cardano is. He just doesn't sit on hold any more."

---

## Facts to get right

| | |
|---|---|
| Price | `0.05 tUSDM base + 0.05/expected minute` — ~0.20 for a quick question, ~0.80 for a long hold |
| Agent identifier | `67ab0c92…f4000000` |
| Registration tx | `3ec929b568391003c3b765283c9743928e1e46dbf2199e60675ca769b909b544` |
| Collection tx | `2c499142236b5a1c4db2e0aaef1e318a1d9ba8d931ba4cb6511cf4c1d9966c83` (1 tUSDM, block 5263500) |
| API | `https://agent-api-production-4ce3.up.railway.app` |

**Don't say "50 cents"** — the real number is better, because it shows price scaling with the hold time we absorb.

**Don't say "Sokosumi credits"** for the agent-to-agent path. Credits are the fiat-side product for humans hiring through the marketplace. Agent-to-agent is USDM on Cardano through Masumi escrow. Blurring them loses the strongest part of the story with the people most likely to notice.

**Don't say "we make good money on that."** The argument is that micropayments are *possible at all*, not that we profit.

---

## Questions you will get

**"Is the escrow real if you're both buyer and seller?"**
For the consumer path we front it, so it is an audit trail more than a trustless exchange. For agent-to-agent it is genuinely two parties. **Say that.** Pretending otherwise loses credibility with exactly the people who can tell.

**"What stops it calling my mum?"**
An explicit allowlist, checked before dialing, plus no cold calls, no bulk, and no exceeding the authorization it was given. Be upfront that consent and call-recording law are a real design question we have scoped rather than solved.

**"What if the call fails?"**
No result hash is submitted, and the escrow refunds the buyer automatically at the deadline. We have one on-chain. Most teams cannot answer this at all — lead with it.

**"Is it live on the marketplace?"**
Registered on Masumi and hireable now over MIP-003. Public Sokosumi listing is pending their approval. That is a normal day-one state and nobody will hold it against us.

---

## Risk worth naming

The pregnancy hook is funny and will be remembered. The hazard is that it demos *an AI delivering serious personal news to family*, which is a more contested use than "sat on hold for me". If a judge is unsympathetic, the most memorable moment is also the most questionable one.

Cheap insurance: keep the scene, and let Dispatch's opening line stay as it is — it already says it is calling on someone's behalf, and it admits to being an AI the moment it is asked. That costs nothing comedically and pre-empts the objection.
