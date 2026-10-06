# Dispatch — agent API and worker in one image, selected at runtime by PROCESS.
#
# They ship together because they share the agent code and must not drift in
# production: a worker running different brief-parsing from the API that hashed
# the input would make the on-chain commitment wrong.
FROM node:24-slim AS base
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/
COPY apps/worker/package.json apps/worker/
COPY apps/agent-api/package.json apps/agent-api/
RUN npm ci --omit=optional

COPY packages/schema packages/schema
COPY apps/worker apps/worker
COPY apps/agent-api apps/agent-api
COPY scripts scripts

# PROCESS=api serves MIP-003; PROCESS=worker polls Sokosumi.
# Exactly one worker may run at a time — see README operational rule 2. Do not
# scale this service past one replica.
ENV PROCESS=api
EXPOSE 3013
CMD ["sh", "-c", "if [ \"$PROCESS\" = worker ]; then npx tsx apps/worker/src/index.ts; else npx tsx apps/agent-api/src/index.ts; fi"]
