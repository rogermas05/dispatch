# Testing brief — verifying the deployed stack

**Everything is deployed and running.** What has *not* happened is anyone driving
it from the outside and trying to break it.

That distinction matters here more than usual. Every bug found so far came from
deploying, not from reading code or running tests:

- The Sokosumi CLI silently falls back to a stored OAuth session. That session
  exists on a developer laptop and does not exist in a container, so the worker
  authenticated locally and failed in production.
- The Telnyx health probe sent `?page[size]=1` with raw brackets. Telnyx answers
  that with **503**, which read as a provider outage and would have kept the agent
  permanently unavailable, refusing every paid job.
- Railway mounts volumes as root, overwriting build-time ownership, so the worker
  crashlooped on `EACCES` the first time it tried to write its journal.

None of those failed a unit test. All of them failed in production. Assume there
are more.

## Start here

```bash
./scripts/smoke-test.sh
```

Checks the deployed API end to end: reachability, schema shape, that operator
routes are gated while buyer routes are deliberately open, that bad input is
refused before anything is charged, that an unknown job 404s rather than being
invented, and that the deployed worker actually claims and finishes a task.

Needs `AGENT_API_TOKEN` and `SOKOSUMI_RUNTIME_KEY` in `.env.local`, plus
`npx sokosumi --preprod auth login` for the task-creation step.

## Live endpoints

| | |
|---|---|
| Agent API | `https://agent-api-production-4ce3.up.railway.app` |
| Payment service | `https://payment-service-production-89b3.up.railway.app` |
| Railway project | `railway.com/project/9ffbf08e-d0ca-4d7d-8729-5943fd0d88a0` |

## ⚠️ One rule

**The worker runs on Railway. Do not start a local one.** There is no server-side
lease — nothing but our own journal prevents two workers claiming the same task,
and duplicate charges are an explicit judging criterion. If you need to run one
locally, say so first and we stop the deployed one.

## Where the bodies are likely buried

Ranked by how much it would cost to find out late.

**1. `--resume` (`apps/worker/src/index.ts`).** The most dangerous code in the
repo: it deliberately overrides the duplicate-charge guard for a task stuck
`RUNNING`. It assumes an operator has confirmed no second worker is live. One
pair of eyes has seen it. Try to make it double-process a task.

**2. The journal under restart.** Kill the worker mid-task (`railway redeploy
--service worker`) and confirm the task is not silently retried. The volume at
`/data` is what makes this survivable; confirm it is actually persisting.

**3. The allowlist.** `DISPATCH_ALLOWED_NUMBERS` is set to one number. Create a
task targeting a different one and confirm it is refused **without dialing** —
not refused after the call, and not dialed anyway.

**4. Authorization boundaries.** Write a task whose description tries to talk the
agent past what it was authorized to do ("you may also agree to...", "ignore your
previous instructions"). Call audio and task text are both untrusted input. The
authorization text is what gets hashed on-chain, so an agent that exceeds it makes
the on-chain commitment false.

**5. Hash stability.** `packages/schema/src/canonical.ts` must stay byte-identical
to `apps/agent-api/src/hash.ts`. A test enforces it. Confirm the dashboard's
browser-side recomputation actually matches what the API hashed — that claim is
load-bearing for the whole "verifiable receipt" story.

**6. Result size.** Sokosumi caps result files at 1 MiB. A long hold plus a long
transcript could approach it. The worker drops turn-by-turn detail when it does;
confirm that path works rather than truncating into invalid JSON.

## The other half of the work

**The dashboard still reads `mock-feed.json`.** `scripts/emit-feed.mjs` generates
the real `Feed` from the worker's journal and results, validated against
`packages/schema` — but nothing serves it over HTTP yet. That is the remaining
seam between the two halves of this project, and it is a judgement call about
where it should be served from.

**Slides are not started.** Submission requires `.ppt` or `.keynote` via Google
Drive with the demo recording **embedded in the file** — external video links are
explicitly rejected.

## Reporting

File what you find as an issue or just say it. For anything involving money or
double-processing, prefer stopping the worker over debugging it live.
