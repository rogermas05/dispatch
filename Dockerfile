# Dispatch — agent API and worker in one image, selected at runtime by PROCESS.
#
# They ship together because they share the agent code and must not drift in
# production: a worker running different brief-parsing from the API that hashed
# the input would make the on-chain commitment wrong.
FROM node:24-slim AS base
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/
COPY apps/worker/package.json apps/worker/
COPY apps/agent-api/package.json apps/agent-api/
COPY apps/web/package.json apps/web/
# Dev dependencies are included on purpose: the processes run through tsx, and
# the worker shells out to the Sokosumi CLI (a root dev dependency).
RUN npm ci --include-workspace-root \
      --workspace @token-origins/schema --workspace @token-origins/worker --workspace @token-origins/agent-api \
 && npm cache clean --force

COPY packages/schema packages/schema
COPY apps/worker apps/worker
COPY apps/agent-api apps/agent-api
COPY scripts scripts

# Jobs, the task journal and results must survive redeploys: mount a persistent
# volume at /data. Losing it mid-escrow loses what was committed on-chain.
ENV NODE_ENV=production \
    JOBS_DIR=/data/jobs \
    JOURNAL_DIR=/data/journal \
    RESULT_DIR=/data/results
RUN mkdir -p /data && chown -R node:node /data
# No VOLUME directive: Railway rejects it and supplies its own volumes. The
# worker's journal must survive a restart — without it a task already in flight
# could be picked up a second time — so /data is a Railway Volume in production.
USER node

# PROCESS=api serves MIP-003 and runs paid jobs; PROCESS=worker polls Sokosumi.
# Exactly one replica of each — see README operational rule 2.
ENV PROCESS=api
EXPOSE 3013
CMD ["sh", "-c", "if [ \"$PROCESS\" = worker ]; then exec npx tsx apps/worker/src/index.ts; else exec npx tsx apps/agent-api/src/index.ts; fi"]
