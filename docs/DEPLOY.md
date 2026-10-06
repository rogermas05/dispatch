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
| `agent-api` | MIP-003 endpoints, port 3013 | Needs a stable public URL — this is the `apiBaseUrl` |
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

- **agent-api** — `PROCESS=api`, generate a domain, set `AGENT_API_TOKEN`
- **worker** — `PROCESS=worker`, **replicas: 1**
- **payment-service** — deploy `masumi-payment-service/`, `PORT=3012`

### Environment

Copy every value from `.env.local`. Three need care:

- `DATABASE_URL` — Railway's managed Postgres, not localhost.
- **`ENCRYPTION_KEY` — must be byte-identical to the one that seeded the local
  database.** This key plus the database *is* the seller wallet. If you deploy
  with a new key against a fresh database, the payment service generates new
  wallets, the registry NFT is orphaned, and the agent can never be
  deregistered. Migrate the database; do not reseed.
- `AGENT_API_TOKEN` — set it in production. Without it every MIP-003 route except
  `/availability` is open.

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

## After deploying

1. Confirm `GET https://<agent-api>/availability` returns 200.
2. Register the agent with `apiBaseUrl` set to that URL → Checkpoint 3.
3. Run a paid task → Checkpoint 4.
4. **Close the laptop and run a task end to end.** That is Checkpoint 5, and it
   is the only way to find out whether anything still secretly depends on this
   machine.

## Alternatives

Fly.io or Render work equally well. Vercel suits the dashboard (`apps/web`) but
not the worker — it has no long-running process, and the worker must poll
continuously.
