// The dashboard feed: one snapshot of everything the evidence dashboard shows.
// The live backend and the mock generator both produce this shape; the dashboard
// validates it at load. Events are an append-only log the dashboard replays.
import { z } from "zod";
import { TOTAL_BPS } from "./royalty.ts";

const Id = z.string().min(1);
const Amount = z.string().regex(/^\d+$/, "asset amounts are nonnegative integer strings");
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase 64-char hex digest");
const Timestamp = z.iso.datetime({ offset: true });
const Score = z.number().min(0).max(1);
const Count = z.number().int().min(0);

/** VERIFIED = chain-checked or measured by us; REPORTED = a service told us; MOCK = generated demo data. */
export const Verification = z.enum(["verified", "reported", "mock"]);

export const AgentRole = z.enum(["broker", "storefront", "producer", "customer"]);

export const Agent = z.object({
  id: Id,
  name: z.string(),
  role: AgentRole,
  provider: z.string().nullable(),
  masumi_agent_identifier: z.string().nullable(),
});

export const RunMetrics = z.object({
  tool_calls: Count,
  failed_tool_calls: Count,
  tokens: Count,
  duration_ms: Count,
  compute_cost_usd: z.number().min(0),
});

export const ScoreComponents = z.object({
  relevance: Score,
  context_match: Score,
  observed_success: Score,
  evidence_quality: Score,
  freshness: Score,
  creator_reliability: Score,
});

export const SearchHit = z.object({
  experience_id: Id,
  score: Score,
  components: ScoreComponents,
  compatible: z.boolean(),
});

export const SearchDecision = z.enum(["purchase", "cold_start", "reuse_entitled"]);

export const Task = z.object({
  id: Id,
  sokosumi_task_id: z.string().nullable(),
  title: z.string(),
  brief: z.string(),
  producer_id: Id,
  search: z.object({
    query: z.string(),
    hits: z.array(SearchHit),
    decision: SearchDecision,
    chosen_experience_id: Id.nullable(),
  }),
  metrics: RunMetrics,
  baseline: RunMetrics.nullable(),
  result_summary: z.string(),
  published_experience_id: Id.nullable(),
});

const SplitEntry = z.object({ recipient_id: Id, bps: z.number().int().min(0).max(TOTAL_BPS) });

export const EvidenceLevel = z.enum(["self_report", "artifact", "evaluator"]);

export const Experience = z.object({
  id: Id,
  digest: Hex64,
  creator_id: Id,
  task_id: Id.nullable(),
  seeded: z.boolean(),
  problem: z.string(),
  teaser: z.string(),
  context: z.record(z.string(), z.string()),
  evidence_level: EvidenceLevel,
  parents: z.array(z.object({ experience_id: Id, digest: Hex64 })).max(4),
  split: z.array(SplitEntry).min(1),
  price: Amount,
});

export const ReceiptKind = z.enum(["registration", "funds_locked", "result_submitted", "collection", "payout", "anchor"]);

export const Receipt = z.object({
  id: Id,
  kind: ReceiptKind,
  tx_hash: Hex64.nullable(),
  verification: Verification,
  explorer_url: z.url().nullable(),
});

export const Order = z.object({
  id: Id,
  buyer_id: Id,
  task_id: Id,
  experience_id: Id,
  amount: Amount,
  collected_amount: Amount.nullable(),
  platform_fee: Amount.nullable(),
});

export const RoyaltyAllocation = z.object({
  id: Id,
  order_id: Id,
  recipient_id: Id,
  amount: Amount,
  payout_receipt_id: Id.nullable(),
});

export const EventKind = z.enum([
  "agent_registered",
  "task_received",
  "search_completed",
  "tool_call",
  "result_evaluated",
  "result_delivered",
  "experience_published",
  "order_placed",
  "funds_locked",
  "content_delivered",
  "payment_collected",
  "royalty_allocated",
  "payout_confirmed",
]);

export const FeedEvent = z.object({
  id: Id,
  seq: Count,
  at: Timestamp,
  kind: EventKind,
  label: z.string(),
  ok: z.boolean().default(true),
  agent_id: Id.optional(),
  task_id: Id.optional(),
  experience_id: Id.optional(),
  order_id: Id.optional(),
  allocation_id: Id.optional(),
  receipt_id: Id.optional(),
});

const FeedShape = z.object({
  schema_version: z.literal(1),
  generated_at: Timestamp,
  mode: z.enum(["mock", "preprod"]),
  network: z.literal("Preprod"),
  asset: z.object({ symbol: z.string(), unit: z.string(), decimals: z.number().int().min(0).max(18) }),
  platform_fee_bps: z.number().int().min(0).max(TOTAL_BPS),
  agents: z.array(Agent),
  tasks: z.array(Task),
  experiences: z.array(Experience),
  orders: z.array(Order),
  allocations: z.array(RoyaltyAllocation),
  receipts: z.array(Receipt),
  events: z.array(FeedEvent),
});

type FeedInput = z.infer<typeof FeedShape>;

/** Cross-record rules a JSON Schema can't express: references resolve, ordering holds, mock data stays labeled. */
function checkIntegrity(feed: FeedInput, ctx: z.RefinementCtx): void {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const ids = (items: { id: string }[]) => new Set(items.map((item) => item.id));
  const agents = ids(feed.agents);
  const tasks = ids(feed.tasks);
  const experiences = ids(feed.experiences);
  const orders = ids(feed.orders);
  const allocations = ids(feed.allocations);
  const receipts = ids(feed.receipts);
  const ref = (set: Set<string>, id: string | null | undefined, path: (string | number)[], what: string) => {
    if (id != null && !set.has(id)) fail(path, `unknown ${what} "${id}"`);
  };

  feed.tasks.forEach((task, i) => {
    ref(agents, task.producer_id, ["tasks", i, "producer_id"], "agent");
    ref(experiences, task.published_experience_id, ["tasks", i, "published_experience_id"], "experience");
    ref(experiences, task.search.chosen_experience_id, ["tasks", i, "search", "chosen_experience_id"], "experience");
    task.search.hits.forEach((hit, j) => ref(experiences, hit.experience_id, ["tasks", i, "search", "hits", j], "experience"));
  });

  feed.experiences.forEach((exp, i) => {
    ref(agents, exp.creator_id, ["experiences", i, "creator_id"], "agent");
    ref(tasks, exp.task_id, ["experiences", i, "task_id"], "task");
    exp.parents.forEach((p, j) => ref(experiences, p.experience_id, ["experiences", i, "parents", j], "experience"));
    exp.split.forEach((s, j) => ref(agents, s.recipient_id, ["experiences", i, "split", j], "agent"));
    const total = exp.split.reduce((sum, s) => sum + s.bps, 0);
    if (total !== TOTAL_BPS) fail(["experiences", i, "split"], `split totals ${total} bps, expected ${TOTAL_BPS}`);
    if (exp.split[0]?.recipient_id !== exp.creator_id) fail(["experiences", i, "split", 0], "split entry 0 must be the creator");
  });

  feed.orders.forEach((order, i) => {
    ref(agents, order.buyer_id, ["orders", i, "buyer_id"], "agent");
    ref(tasks, order.task_id, ["orders", i, "task_id"], "task");
    ref(experiences, order.experience_id, ["orders", i, "experience_id"], "experience");
  });

  feed.allocations.forEach((alloc, i) => {
    ref(orders, alloc.order_id, ["allocations", i, "order_id"], "order");
    ref(agents, alloc.recipient_id, ["allocations", i, "recipient_id"], "agent");
    ref(receipts, alloc.payout_receipt_id, ["allocations", i, "payout_receipt_id"], "receipt");
  });

  feed.receipts.forEach((receipt, i) => {
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
    ref(agents, event.agent_id, ["events", i, "agent_id"], "agent");
    ref(tasks, event.task_id, ["events", i, "task_id"], "task");
    ref(experiences, event.experience_id, ["events", i, "experience_id"], "experience");
    ref(orders, event.order_id, ["events", i, "order_id"], "order");
    ref(allocations, event.allocation_id, ["events", i, "allocation_id"], "allocation");
    ref(receipts, event.receipt_id, ["events", i, "receipt_id"], "receipt");
  });
}

export const Feed = FeedShape.superRefine(checkIntegrity);

export type Verification = z.infer<typeof Verification>;
export type AgentRole = z.infer<typeof AgentRole>;
export type Agent = z.infer<typeof Agent>;
export type RunMetrics = z.infer<typeof RunMetrics>;
export type ScoreComponents = z.infer<typeof ScoreComponents>;
export type SearchHit = z.infer<typeof SearchHit>;
export type Task = z.infer<typeof Task>;
export type Experience = z.infer<typeof Experience>;
export type ReceiptKind = z.infer<typeof ReceiptKind>;
export type Receipt = z.infer<typeof Receipt>;
export type Order = z.infer<typeof Order>;
export type RoyaltyAllocation = z.infer<typeof RoyaltyAllocation>;
export type EventKind = z.infer<typeof EventKind>;
export type FeedEvent = z.infer<typeof FeedEvent>;
export type Feed = z.infer<typeof Feed>;
