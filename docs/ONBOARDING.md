# Onboarding — getting a second builder to the same place

Read [`README.md`](../README.md) first, then [`docs/FINDINGS.md`](FINDINGS.md).
`FINDINGS.md` overrides [`docs/PLAN.md`](PLAN.md) wherever they disagree.

---

## 1. Clone and install

```bash
git clone https://github.com/rogermas05/token-origins.git
cd token-origins
npm install
npx sokosumi --version        # expect 1.0.4
```

The Sokosumi CLI is a project devDependency, not a global install — use
`npx sokosumi`. Node 24+ required.

The real CLI documentation ships inside the package. `npx sokosumi skills path`
prints the directory; start at `skills/sokosumi/SKILL.md`. Note that
`sokosumi <subcommand> --help` is **not implemented** — it reprints top-level
usage, so those SKILL.md files are the only flag reference that exists.

---

## 2. Credentials

Copy the template and fill it in. **Never commit this file.**

```bash
cp .env.example .env.local && chmod 600 .env.local
```

| Variable | Where it comes from | Shared or personal? |
|---|---|---|
| `SOKOSUMI_COWORKER_ID` | below | shared — already fixed |
| `SOKOSUMI_VENDOR_ID` | below | shared |
| `SOKOSUMI_WORKSPACE_ID` | below | shared |
| `SOKOSUMI_ORG_ID` / `_SLUG` | below | shared |
| `SOKOSUMI_RUNTIME_KEY` | ask Aman | **shared secret — never commit** |
| `ANTHROPIC_API_KEY` | ask Aman | **shared secret** |
| `BLOCKFROST_API_KEY_PREPROD` | ask Aman, or your own free Preprod key | shared or personal |
| `ENCRYPTION_KEY`, `ADMIN_KEY` | generated at Phase 3 | **shared, and irreplaceable** |

Secrets travel over a private channel, never through this repo, an issue, or a
commit message. For a 36-hour preprod hackathon, sharing them across the team is
fine — with one exception noted in §5.

### Non-secret IDs (safe to copy)

```
SOKOSUMI_ORG_ID=01a10fd0-67f5-709f-9874-4627dc671212
SOKOSUMI_ORG_SLUG=substantiate-0e6jg5
SOKOSUMI_VENDOR_ID=01a10fd1-9907-77ba-92d0-ac202cedd643
SOKOSUMI_COWORKER_ID=01a10fd1-dd7b-7415-91e1-0bf91fb6d76c
SOKOSUMI_WORKSPACE_ID=01a10fc8-74b3-76c5-8281-53c228e71459
SOKOSUMI_EVENT_WORKSPACE_ID=01a109d1-32a9-71a3-a0e3-658b2a7987cd
```

---

## 3. Your own Sokosumi login (optional)

Only needed to inspect things in the marketplace under your own identity. The
Vendor and Coworker live on Aman's account; you do not need your own to run the
agent.

```bash
npx sokosumi --preprod auth login
npx sokosumi --preprod auth whoami --json
```

That opens a browser and expects the redirect to return to **the same machine**.
If you are working on a remote box, see §6.

To be added to the `Substantiate` organization, send Aman your account email.

---

## 4. What already exists

| Thing | Value |
|---|---|
| Organization | `Substantiate` (`substantiate-0e6jg5`), Aman is `owner` |
| Vendor | `Substantiate` (`substantiate`), Aman is `admin` |
| Coworker | `Substantiate Claims Checker` (`substantiate-claims-checker`) |
| Workspace access | `GRANTED` — in the **Personal** Workspace, not the org |
| Credits | 3,250 on the free personal seat |

Checkpoints 0 and 1 are VERIFIED. Evidence is in `.local/` — gitignored, so ask
Aman for a copy if you need it.

Tasks run in the **Personal Workspace** (`--personal`) because the credits sit on
the personal seat while organization credits are a separate pool. Connection to
the TOKEN2049 organization is a Phase 6 step.

---

## 5. Rules that are not negotiable

These each map to a way the project fails irrecoverably. Details in `README.md`.

1. **Exactly one worker runs at a time, anywhere.** There is no server-side lease
   — verified, see `FINDINGS.md` §3. If two of us poll, we double-process tasks
   and produce duplicate charges, which judges explicitly score. Say so in chat
   before you start a worker. This is the one real hazard of sharing keys.
2. **Never reseed or replace wallets, and never lose `ENCRYPTION_KEY`.** That key
   plus its Postgres database *is* the seller wallet. Losing it destroys the
   registry NFT permanently.
3. **No secrets in git, ever.** `.gitignore` covers `.env*`, key material and
   `.local/`, but the discipline is the point, not the tooling.
4. **Don't infer payment from task completion.** `runtime complete` moves a task
   to `COMPLETED` and touches no money. Only a confirmed on-chain collection
   transaction counts.

---

## 6. Authenticating from a machine you are not sitting at

The OAuth flow is PKCE over a loopback redirect to `127.0.0.1:53682`, so the
browser has to reach the machine running the CLI. If you are remote, relay the
callback — this is how Aman authenticated:

```bash
# On the CLI machine: capture the authorize URL instead of opening a browser
mkdir -p /tmp/sok-shim
printf '#!/bin/sh\nprintf "%%s\\n" "$@" >> /tmp/sok-authurl.txt\n' > /tmp/sok-shim/open
chmod +x /tmp/sok-shim/open
PATH="/tmp/sok-shim:$PATH" npx sokosumi --preprod auth login --oauth-timeout-ms 900000 &
sleep 8 && cat /tmp/sok-authurl.txt
```

Open that URL in your browser, approve, and let the redirect to `127.0.0.1:53682`
fail — that failure is expected. Copy the full URL out of the address bar and
replay it on the CLI machine:

```bash
curl -s "http://127.0.0.1:53682/oauth/callback?code=...&state=..."
```

The waiting process holds the PKCE verifier in memory and completes the exchange.
The authorization code is single-use and expires in seconds, which makes this
safer than passing a long-lived API key around.

---

## 7. Where the build is

Checkpoints 0 and 1 are done. Next is Phase 2: an agent that completes an unpaid
task end to end. Current status and the full checkpoint table are in `README.md`.
