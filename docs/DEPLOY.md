# Deployment — Phase 5

**Why this comes before Checkpoint 3, not after.** Masumi registration mints an
NFT carrying the agent's `apiBaseUrl`. Changing that later means deregistering
and re-registering, and deregistration depends on still holding the wallet. So
the URL has to be stable *before* we register, which makes hosting a
prerequisite for on-chain registration rather than a finishing step.

The other reason is blunter: **the node must be alive when `unlockTime` passes.**
Blockchains have no cron. If nothing is running at that moment, no collection
transaction is submitted, we are not paid, and there is no valid submission.
A laptop is not an acceptable host for that.

## Three services

| Service | What it is | Notes |
|---|---|---|
| `agent-api` | MIP-003 endpoints, port 3013, **and the paid-job runner** | Needs a stable public URL (the `apiBaseUrl`) and a persistent volume at `/data`. **Exactly one replica.** |
| `worker` | Sokosumi poller | **Exactly one replica. Never scale this.** |
| Masumi Payment Service + Postgres | Escrow, result hashes, collection | Must outlive every `unlockTime` |

## Recommended: Railway

One project, three services, one managed Postgres. Chosen because the payment
service and its database have to sit together and stay up; splitting them across
providers adds a failure mode for no benefit.

```bash
railway init
railway add --database postgres
railway up            # builds the Dockerfile
```

Then per service:

- **agent-api** — `PROCESS=api`, generate a domain, **attach a volume at `/data`**, replicas: 1
- **worker** — `PROCESS=worker`, **attach a volume at `/data`**, **replicas: 1**
- **payment-service** — deploy `masumi-payment-service/`, `PORT=3012`

### Environment

Copy every value from `.env.local`. Three need care:

- `DATABASE_URL` — Railway's managed Postgres, not localhost.
- **`ENCRYPTION_KEY` — must be byte-identical to the one that seeded the local
  database.** This key plus the database *is* the seller wallet. If you deploy
  with a new key against a fresh database, the payment service generates new
  wallets, the registry NFT is orphaned, and the agent can never be
  deregistered. Migrate the database; do not reseed.
- `AGENT_API_TOKEN` — protects only the operator route `GET /jobs`. **The MIP-003
  buyer routes (`/availability`, `/input_schema`, `/start_job`, `/status`) are
  public by design**: Sokosumi and Masumi buyers never hold our token, and gating
  them would make Dispatch unhireable. The escrow is the access control — nothing
  is dialed until funds are confirmed locked — plus a per-client rate limit on
  `/start_job`.
- `DISPATCH_ALLOWED_NUMBERS` — E.164 numbers Dispatch may call. Empty with real
  telephony means every job is refused. Only lines we own or that consented.
- `MPS_PAY_KEY` — the scoped read+pay key from `scripts/register-agent.mjs key`.
  Don't run the agent API on `ADMIN_KEY`.
- `TELNYX_VOICE` / `TELNYX_VOICE_API_KEY_REF` — voice is config. ElevenLabs is
  `elevenlabs.<model>.<voice_id>` plus a Telnyx integration secret name.
- `/data` — jobs (`JOBS_DIR`), the task journal and results live here. A paid job
  spans a call, a result deadline and a dispute window; losing this volume
  mid-escrow loses what was committed on-chain.

### Migrating the database rather than reseeding

```bash
pg_dump masumi_payment > masumi.sql
psql "$RAILWAY_DATABASE_URL" < masumi.sql
```

Verify the seller address afterwards is the one in `.env.local`:

```sql
SELECT type, "walletAddress" FROM "HotWallet";
```

If it differs, stop — the wallet has been regenerated and funds and identity are
on the old one.

## Before deploying

```bash
npm test
npm run smoke -w @token-origins/agent-api   # full paid MIP-003 path over HTTP, fake MPS
docker build -t dispatch .
```

## After deploying — from URL to "another agent hired us"

1. **Agent API is reachable.** `GET https://<agent-api>/input_schema` returns the
   schema; `/availability` lists what is still missing (expected: registration).
2. **Scoped pay key.** `node --env-file=.env.local scripts/register-agent.mjs key`
   → set the printed `MPS_PAY_KEY` on the agent API.
3. **Check what will be registered.** `... register-agent.mjs inspect` shows the
   seller wallet and V2 payment source. Confirm the wallet is the funded one.
4. **Register** with `AGENT_API_PUBLIC_URL=https://<agent-api>`:
   `... register-agent.mjs register`, then `... register-agent.mjs status` until
   `RegistrationConfirmed` → Checkpoint 3. Set the printed `AGENT_IDENTIFIER` on
   the agent API and restart it; `/availability` must now say `available`.
5. **Discoverable by other agents.** `npx sokosumi agents list --search Dispatch --json`
   shows it. A confirmed NFT alone does not prove marketplace visibility.
6. **A real agent hire** (Checkpoint 4 candidate), to a number in the allowlist:
   ```bash
   npx sokosumi agents hire <AGENT_ID> --max-credits 25 --json --input-json \
     '{"to":"+1...","objective":"...","authorization":"Nothing: gather information only"}'
   npx sokosumi jobs get <JOB_ID> --details --json
   ```
   Then `GET /jobs` (operator token) shows the job move `awaiting_payment →
   calling → awaiting_confirmation → completed`. Collection happens after
   `unlockTime` (90 min by default); verify it with
   `scripts/verify-seller-receipt.mjs`, never the payment service's own report.
7. **Close the laptop and run another hire end to end.** That is Checkpoint 5.

Never redeploy the agent API while a call is in progress: a call cut off by a
restart is failed and never re-dialed, and the buyer is refunded after
`submitResultTime`.

## Alternatives

Fly.io or Render work equally well. Vercel suits the dashboard (`apps/web`) but
not the worker — it has no long-running process, and the worker must poll
continuously.
