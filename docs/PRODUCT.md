# Dispatch — what we are building and why

**Dispatch is a voice agent that makes phone calls on behalf of whoever hires it,
and it can be hired by humans or by other AI agents.**

It lives on the Sokosumi marketplace, is paid per call in on-chain USDM through
Masumi escrow, and returns a recording, a transcript, and a structured outcome.

---

## 1. The two demand sides

They are genuinely different customers with different reasons to pay, and the
same agent serves both.

### Agent-to-agent — the structural one

**Agents cannot make phone calls.** Not "are bad at" — *cannot*. An LLM agent has
no phone number, no telephony stack, no way to hold a real-time audio conversation
with a person. Every agent on the Sokosumi marketplace is scoped to one thing it
does well, and a large fraction of them hit a wall at the same place: the next
step requires talking to a human on a phone.

- A support-ticket agent resolves tickets until one needs the vendor's support
  line called.
- An insurance-claims agent processes denials until it needs the carrier called to
  find out *why* a claim actually failed.
- A logistics agent reconciles deliveries until it needs the depot called.

Each of those is a dead end today. The agent returns "a human needs to call X,"
and a human does. Dispatch turns that dead end into **a tool call** — a thing
another agent invokes, pays for, and gets a transcript back from.

This is the sharper wedge for three reasons. It needs no consumer marketing: the
demand already exists inside workflows that are already running. It compounds with
the marketplace rather than with our own distribution. And it is exactly what
Masumi exists for — one autonomous agent paying another, with escrow, for work
neither party's operator supervised.

### Consumer — the one that makes it a phenomenon

Nobody wants to sit on hold for two hours to argue with their insurance company.
This is not a hypothetical persona; it is the complaint that started this project.

The people who suffer most from phone systems are, almost definitionally, **not
developers**. They have no way to automate their way out. They can't script
anything, and the tools being built in this space are aimed at businesses:
AI voice for B2B SaaS is crowded, AI voice *for the person being called* is not.

And there's a reversal worth naming plainly. Companies are deploying AI voice
agents to handle inbound calls — to deflect, to queue, to wear people down. The
humans on the other end are furious about it. Dispatch hands those humans the same
weapon: **send your agent to deal with their agent.** You stop being the one who
waits.

That asymmetry is the cultural story. It's also, concretely, why a consumer will
pay ~$0.50 to never hear hold music again.

---

## 2. Why this belongs on Masumi and Cardano

A voice agent could be a SaaS product with a credit card form. Several are. The
protocol has to earn its place, or judges will correctly read the chain as
decoration.

**Agents can't hold credit cards.** The agent-to-agent path has no good payment
rail *other* than something like Masumi. A support-ticket agent that needs to buy
a phone call mid-task cannot open a Stripe account, pass KYC, or enter a CVV. It
can hold a wallet and pay per call. On-chain micropayment isn't a flourish here;
it's the only mechanism that makes the primary use case work at all.

**Decision logging has real teeth.** Masumi writes SHA-256 hashes of input and
output on-chain. For most agents this proves something abstract. For Dispatch the
input is *the instruction we were given* — what to ask for, what to authorize, what
limits not to exceed — and the output is *the transcript of a conversation that
actually happened*. Both hashed, both timestamped, neither alterable after the
fact.

That matters the moment anything is contested. Did the agent agree to something it
shouldn't have? Did the carrier's rep say what we claim they said? Did we even
place the call? A phone call is otherwise the least auditable interaction in
business, and we make it the most.

**The escrow window fits the work.** Funds lock before the call, the call takes
minutes, the result is submitted, and the buyer gets a window to dispute. That is
precisely the "minute-long contestable work" shape the Masumi escrow method is
designed for — unlike a cheap metered API call, where direct address payment would
be the right tool.

**The output is a checkable artifact.** A recording, a transcript, and a structured
outcome. Not a vibe. A judge can listen to it. The protocol can prove integrity —
that we delivered exactly what we committed to the ledger — and the artifact itself
demonstrates quality, which is the right division of labor between the chain and
the work.

---

## 3. What a job looks like

**Input:** who to call, what to accomplish, what the agent is authorized to say or
agree to, and what to do when it needs a decision it wasn't given.

**The call:** Dispatch dials, navigates the phone tree, waits on hold, states the
case, and pursues the objective. It does not improvise past its authorization.

**Output:** a recording, a full transcript, a structured outcome (what was
achieved, what was refused, what needs a human), and any reference numbers
obtained — the thing that actually makes the call useful to whatever comes next.

**Price:** roughly €0.05–7 per call depending on expected duration. Sits
comfortably inside the marketplace's credit economics, and inside what a person
pays to not spend two hours on hold.

---

## 4. Boundaries we hold

Not legal advice, and some of these are product decisions as much as compliance
ones.

- **Dispatch identifies itself as an AI agent** when asked, and where required.
  The pitch is "send your agent to deal with their agent," not deception.
- **Recording consent.** Call recording law varies by jurisdiction, including
  two-party-consent rules. Demos and tests call lines we control or parties who
  have consented.
- **Inbound-to-business only.** Dispatch calls companies on behalf of someone who
  has a relationship with them. It is not a tool for calling strangers, and it
  will never be pointed at consumer phone numbers in bulk. That is the line
  between this and a robocaller, and it is a bright one.
- **Authorization is explicit and bounded.** The agent acts within what the task
  grants it and escalates rather than inventing authority — which is exactly what
  the on-chain input hash pins down.

---

## 5. What stays the same

The pivot is a product change, not an architecture change. Everything in
[`BUILD.md`](BUILD.md) still holds: the four layers, the escrow state machine, the
three long-lived processes, the phase order, every failure mode, and the evidence
discipline. Checkpoints 0 and 1 remain VERIFIED.

The one genuinely new dependency is **telephony** — a provider that gives the agent
a phone number and a real-time voice pipeline. That is new surface the original
plan did not account for, and it is the main schedule risk.

---

## 6. The demo

Leading with **agent-to-agent**, because it is what Masumi exists for and almost
nobody will show it.

A second agent, mid-task, discovers Dispatch on the marketplace, hires it to place
a call, pays from its own wallet on-chain, receives the transcript, and finishes
its own task with information it could not otherwise have obtained. Second-order
on-chain payment inside a single task.

The consumer story — the person who never has to sit on hold again — is how the
pitch opens and closes, because it is the one a judge feels. The agent-to-agent
path is what we put on the screen.
