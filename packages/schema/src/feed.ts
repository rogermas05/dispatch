// The dashboard feed: one snapshot of everything the Dispatch dashboard shows.
// The live backend and the mock generator both produce this shape; the dashboard
// validates it at load. Events are an append-only log the dashboard replays.
import { z } from "zod";

const Id = z.string().min(1);
const Amount = z.string().regex(/^\d+$/, "asset amounts are nonnegative integer strings");
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase 64-char hex digest");
const Timestamp = z.iso.datetime({ offset: true });
const Seconds = z.number().min(0);

/** VERIFIED = chain-checked or measured by us; REPORTED = a service told us; MOCK = generated demo data. */
export const Verification = z.enum(["verified", "reported", "mock"]);

/** Who hires Dispatch: a person through Sokosumi, or another agent through Masumi. */
export const Hirer = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(["human", "agent"]),
  via: z.enum(["sokosumi", "masumi"]),
  description: z.string(),
});

/** The organization Dispatch phones. Numbers are masked; the feed is public. */
export const Party = z.object({
  id: Id,
  name: z.string(),
  phone_masked: z.string(),
});

/** Exactly the MIP-003 input_data Dispatch accepts; its canonical hash is the on-chain input commitment. */
export const JobInput = z.object({
  to: z.string(),
  objective: z.string(),
  authorization: z.string(),
  context: z.string().optional(),
  max_duration_seconds: z.number().int().positive().optional(),
});

export const CallStatus = z.enum(["completed", "unreachable", "refused", "escalated", "timeout"]);

export const TranscriptTurn = z.object({
  speaker: z.enum(["agent", "other"]),
  text: z.string(),
  atSeconds: Seconds,
});

/** The deliverable, in the worker's CallOutcome shape; its canonical hash is the on-chain output commitment. */
export const CallOutcome = z.object({
  status: CallStatus,
  durationSeconds: Seconds,
  transcript: z.object({ turns: z.array(TranscriptTurn), text: z.string() }),
  recordingUrl: z.string().nullable(),
  providerCallId: z.string(),
  summary: z.string(),
  artifacts: z.record(z.string(), z.string()),
  humanFollowUp: z.string().nullable(),
  caveats: z.array(z.string()),
});

export const Job = z.object({
  id: Id,
  title: z.string(),
  hirer_id: Id,
  party_id: Id,
  sokosumi_task_id: z.string().nullable(),
  blockchain_identifier: z.string().nullable(),
  /** For agent hirers: the task the agent was doing when it needed a phone call. */
  hirer_task: z.object({ title: z.string(), resolution: z.string() }).nullable(),
  input: JobInput,
  input_hash: Hex64,
  price: Amount,
  deadlines: z.object({
    pay_by: Timestamp,
    submit_result_by: Timestamp,
    unlock_at: Timestamp,
    external_dispute_unlock_at: Timestamp,
  }),
  result: CallOutcome.nullable(),
  output_hash: Hex64.nullable(),
});

export const ReceiptKind = z.enum(["registration", "funds_locked", "result_submitted", "collection"]);

export const Receipt = z.object({
  id: Id,
  kind: ReceiptKind,
  job_id: Id.nullable(),
  tx_hash: Hex64.nullable(),
  verification: Verification,
  explorer_url: z.url().nullable(),
});

export const EventKind = z.enum([
  "agent_registered",
  "registry_search",
  "job_started",
  "funds_locked",
  "brief_parsed",
  "dialing",
  "transcript_turn",
  "on_hold",
  "call_ended",
  "outcome_ready",
  "result_submitted",
  "result_delivered",
  "hirer_resumed",
  "payment_collected",
]);

export const FeedEvent = z.object({
  id: Id,
  seq: z.number().int().min(0),
  at: Timestamp,
  kind: EventKind,
  label: z.string(),
  ok: z.boolean().default(true),
  job_id: Id.optional(),
  receipt_id: Id.optional(),
  /** transcript_turn: index into the job's result.transcript.turns. */
  turn_index: z.number().int().min(0).optional(),
  /** on_hold: how long the hold lasted. */
  hold_seconds: Seconds.optional(),
});

const FeedShape = z.object({
  schema_version: z.literal(2),
  generated_at: Timestamp,
  mode: z.enum(["mock", "preprod"]),
  network: z.literal("Preprod"),
  asset: z.object({ symbol: z.string(), unit: z.string(), decimals: z.number().int().min(0).max(18) }),
  dispatch: z.object({ name: z.string(), agent_identifier: Hex64.nullable(), voice_provider: z.string() }),
  hirers: z.array(Hirer),
  parties: z.array(Party),
  jobs: z.array(Job),
  receipts: z.array(Receipt),
  events: z.array(FeedEvent),
});

type FeedInput = z.infer<typeof FeedShape>;

/** Cross-record rules a JSON Schema can't express: references resolve, ordering holds, mock data stays labeled. */
function checkIntegrity(feed: FeedInput, ctx: z.RefinementCtx): void {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const ids = (items: { id: string }[]) => new Set(items.map((item) => item.id));
  const hirers = ids(feed.hirers);
  const parties = ids(feed.parties);
  const receipts = ids(feed.receipts);
  const jobs = new Map(feed.jobs.map((job) => [job.id, job]));
  const ref = (set: { has: (id: string) => boolean }, id: string | null | undefined, path: (string | number)[], what: string) => {
    if (id != null && !set.has(id)) fail(path, `unknown ${what} "${id}"`);
  };

  feed.jobs.forEach((job, i) => {
    ref(hirers, job.hirer_id, ["jobs", i, "hirer_id"], "hirer");
    ref(parties, job.party_id, ["jobs", i, "party_id"], "party");
    if ((job.result === null) !== (job.output_hash === null)) {
      fail(["jobs", i, "output_hash"], "output_hash is present exactly when a result is");
    }
  });

  feed.receipts.forEach((receipt, i) => {
    ref(jobs, receipt.job_id, ["receipts", i, "job_id"], "job");
    if (feed.mode === "mock" && receipt.verification !== "mock") {
      fail(["receipts", i, "verification"], "mock feeds may only contain mock receipts");
    }
    if (receipt.verification === "mock" && receipt.explorer_url !== null) {
      fail(["receipts", i, "explorer_url"], "mock receipts must not link to an explorer");
    }
    if (receipt.verification === "verified" && receipt.tx_hash === null) {
      fail(["receipts", i, "tx_hash"], "a verified receipt needs a transaction hash");
    }
  });

  feed.events.forEach((event, i) => {
    const prev = feed.events[i - 1];
    if (prev && event.seq <= prev.seq) fail(["events", i, "seq"], "event seq must strictly increase");
    ref(jobs, event.job_id, ["events", i, "job_id"], "job");
    ref(receipts, event.receipt_id, ["events", i, "receipt_id"], "receipt");
    if (event.kind === "transcript_turn") {
      const turns = event.job_id ? jobs.get(event.job_id)?.result?.transcript.turns : undefined;
      if (event.turn_index === undefined || !turns || event.turn_index >= turns.length) {
        fail(["events", i, "turn_index"], "transcript_turn must point at an existing turn of its job");
      }
    }
  });
}

export const Feed = FeedShape.superRefine(checkIntegrity);

export type Verification = z.infer<typeof Verification>;
export type Hirer = z.infer<typeof Hirer>;
export type Party = z.infer<typeof Party>;
export type JobInput = z.infer<typeof JobInput>;
export type CallStatus = z.infer<typeof CallStatus>;
export type TranscriptTurn = z.infer<typeof TranscriptTurn>;
export type CallOutcome = z.infer<typeof CallOutcome>;
export type Job = z.infer<typeof Job>;
export type ReceiptKind = z.infer<typeof ReceiptKind>;
export type Receipt = z.infer<typeof Receipt>;
export type EventKind = z.infer<typeof EventKind>;
export type FeedEvent = z.infer<typeof FeedEvent>;
export type Feed = z.infer<typeof Feed>;
