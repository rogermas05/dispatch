# Findings — reconciling the build plan against primary sources

Closed on 2026-10-05, before Phase 0. Still current after the 2026-10-06 pivot
to Dispatch — every finding here is about tooling, not product. Every claim here is labelled **VERIFIED**
(we ran it or read it in shipped source) or **REPORTED** (a page or doc told us).

Primary sources used:
- `masumi.network/token2049` and `/token2049/agent` (fetched)
- **The SKILL.md files bundled inside the CLI package** — `sokosumi skills path`
  resolves to `node_modules/@masumi_network/sokosumi/skills/`. These are the
  authoritative docs that the 403'd npm README was hiding, and they cite their own
  source commits. Start with `skills/sokosumi/SKILL.md`.

---

## 1. The agent concept is unconstrained

**VERIFIED.** The event brief mandates no problem domain, and no required
capability — *"the agent can use any model, tool, or runtime the participant
chooses."* Constraints are technical and procedural only.

Closes the gap flagged in the original plan's confidence log: "the page may specify
a required problem domain." It does not.

This is what makes [`PRODUCT.md`](PRODUCT.md) possible. A voice agent needs an
external telephony dependency that no other entrant is likely to have, and nothing
in the brief restricts that. Its own examples — *compare supplier quotes, draft a
sourced support reply, research an account, reconcile delivery records* — are
notably all workflows that routinely dead-end at a phone call.

---

## 2. ⚠️ The Sokosumi CLI does not implement payment at all

**VERIFIED** — `skills/sokosumi/SKILL.md`, citing merged commit `c2271e441` / PR #5342:

> Receipt support is merged. It reads Core with GET. **Start and completion do not
> submit `masumiPayment` or create an MPS claim.**
> **Seller setup, customer approval, paid execution, and payment recovery remain
> planned.** The planning drafts contain no payment implementation. **Do not infer
> payment capability from the installed Skill or Task completion.**

And **REPORTED** (user decisions, 2026-09-30): the first flow will use an existing
developer-managed MPS seller; *"Implementation is pending. Live seller proof is pending."*

**Consequence.** `runtime start` / `runtime complete` move a Task to `COMPLETED` and
touch no money. Checkpoint 4 — the checkpoint that decides the submission — is
**entirely our own MPS integration**. There is no CLI path to it and no shortcut.
This confirms the plan's Shape A + Shape B split is mandatory rather than
belt-and-braces, and it means the riskiest work has the least documentation.

---

## 3. ⚠️ There is no worker lease — nothing server-side stops double-processing

**VERIFIED** — `skills/sokosumi/SKILL.md`:

> This flow does not create a worker lease, **poll for automatic work**, or install
> an agent host.

There is no claim/lease endpoint. A worker is `tasks list --json`, filtered to
`READY`, with deduplication **we** implement. Sokosumi will happily let two
processes start the same Task.

**Consequence.** Failure mode #2 in the plan (two workers → duplicate charges → a
stated judging criterion) has no backstop but our own journal. The journal-before-write
discipline is the only guard that exists, so it ships in the first version of the
worker, not as a later hardening pass.

---

## 4. `runtime receipt` exists, but is not proof

**VERIFIED.** `sokosumi runtime receipt TASK_ID --coworker-id ID --json` returns
`settled` and sometimes `txHash`. Useful. Not sufficient:

- *"A settled receipt can still have a null `txHash`."*
- *"An error means unknown, not unpaid."*
- It reads Core — it is **REPORTED** payment, not chain-verified.

**Consequence.** Checkpoint 4 still requires an independent Blockfrost query against
the seller address. The receipt is corroboration, not evidence.

---

## 5. Runtime credentials are deliberately separate from human credentials

**VERIFIED.** Human setup uses OAuth or a user API key. Runtime uses a
**Coworker-scoped key**, imported via `sokosumi runtime key-import`, fixed to
Preprod. The docs are explicit: *"Never substitute human OAuth or a user API key for
runtime authentication."*

Pairs with the plan's rule that signing keys stay out of the agent process. Three
credential tiers, never mixed: human OAuth (setup) → Coworker key (execution) →
MPS wallet (money).

---

## 6. Corrections to specific values in the plan

| Plan said | Actual | Source |
|---|---|---|
| `BLOCKFROST_API_KEY` | **`BLOCKFROST_API_KEY_PREPROD`** | event setup page |
| Port `3013` | `3013` is the demo's **MIP-003 agent API**; **MPS runs on `3012`**, admin UI at `http://127.0.0.1:3012/admin/` | event setup page |
| TOKEN2049 workspace — "via the provided link" | Published ID: **`01a109d1-32a9-71a3-a0e3-658b2a7987cd`** | event setup page |
| `coworkers provision --vendor-id …` | Both `register` and `provision` exist. `register --personal` is the documented hackathon path; `register --create-api-key` folds in the key | `skills/sokosumi` |
| Org required before a Vendor | Still true for the Vendor, but the Coworker can live in a **Personal Workspace** via `--personal` — simpler for Phases 2–4 | `skills/sokosumi` |

CLI version installed: **1.0.4** (VERIFIED). Note `sokosumi <subcommand> --help`
is not implemented — it reprints top-level usage. The SKILL.md files are the only
flag reference.

---

## 7. Authority requirements for Phase 1

**VERIFIED.** `coworkers connect` runs its own preflight and needs **both**:

1. Selected Vendor membership with `role: "admin"`, and
2. The selected organization present in `workspaces list`.

A platform-admin role does **not** override this. Also:

- `PENDING` is a successful *request*, not access. Only `GRANTED` is access.
- After approval, **repeat `connect`, never `register`** — re-registering risks a
  duplicate record.
- Preserve the Coworker ID if creation succeeds but access fails.
- Provisioning/registration/connection/admin are **Preprod-only**; `--preprod` is
  required on all of them.
- Never combine `--personal` and organization selectors.

---

## 8. Phase 1, as actually executed

Discovery first — the docs insist on reusing existing records rather than creating:

```bash
sokosumi --preprod auth login                      # browser; operator must do this
sokosumi --preprod auth whoami --json
sokosumi --preprod workspaces list --json
sokosumi --preprod vendors me --json
sokosumi --preprod coworkers list --scope owned --json
```

Then create only what discovery shows is missing:

```bash
sokosumi --preprod vendors create --name NAME --slug SLUG --json
sokosumi --preprod coworkers register --personal --vendor-id VENDOR_ID \
  --name COWORKER_NAME --capability tasks --create-api-key --json
sokosumi --preprod coworkers connect COWORKER_ID --personal --vendor-id VENDOR_ID --json
```

Checkpoint 1 is `GRANTED`, verified independently with
`sokosumi --preprod workspaces check ORGANIZATION_ID --json`.

---

## 9. Still open

- **Result file limits** — UTF-8, ≤ 1 MiB (VERIFIED). Our output format has to fit.
- **MPS registration is partly a web UI step** — register the agent at
  `127.0.0.1:3012/admin/` with *Dynamic* pricing (REPORTED, event page). Not yet
  confirmed whether this is scriptable; if it is not, Phase 5 hosting needs the
  admin UI reachable.
- **"Obtain signed seller terms, submit via Sokosumi Task"** (REPORTED, event page)
  is a step the plan does not describe and we do not yet understand. It sits
  directly on the Checkpoint 4 path. Highest-value unknown remaining.
- The demo repo `masumi-network/demo-agent-token2049` has not been read yet.
- **Telephony provider is not yet chosen** (Phase 2T). New dependency introduced by
  the pivot; nothing in the Masumi or Sokosumi tooling constrains the choice.
