// Static content of the demo story (SPEC.md §13): three Sokosumi tasks against the
// deterministic orders fixture, plus seeded distractor experiences. Numbers here are
// illustrative mock values, never measurements; the feed marks them as mock.
import type { RunMetrics } from "../feed.ts";

export interface MockToolCall {
  label: string;
  ok: boolean;
}

export interface MockAgentSpec {
  id: string;
  name: string;
  role: "broker" | "storefront" | "producer" | "customer";
  provider: string | null;
  registered: boolean;
}

export const AGENTS: MockAgentSpec[] = [
  { id: "sokosumi_user", name: "Sokosumi customer", role: "customer", provider: null, registered: false },
  { id: "broker", name: "Experience Broker", role: "broker", provider: null, registered: true },
  { id: "storefront", name: "Experience Storefront", role: "storefront", provider: null, registered: true },
  { id: "agent_a", name: "Agent A", role: "producer", provider: "anthropic", registered: false },
  { id: "agent_b", name: "Agent B", role: "producer", provider: "anthropic", registered: false },
  { id: "agent_c", name: "Agent C", role: "producer", provider: "anthropic", registered: false },
  { id: "seed_corpus", name: "Seed corpus", role: "producer", provider: null, registered: false },
];

export interface DistractorSpec {
  id: string;
  problem: string;
  context: Record<string, string>;
  relevance: number;
  compatible: boolean;
}

export const DISTRACTORS: DistractorSpec[] = [
  { id: "exp_seed_offset_v0", problem: "Export every record from an offset-paginated API", context: { api: "demo-orders", version: "0" }, relevance: 0.83, compatible: false },
  { id: "exp_seed_graphql", problem: "Paginate GraphQL connections with endCursor", context: { api: "graphql" }, relevance: 0.61, compatible: false },
  { id: "exp_seed_stripe_429", problem: "Retry Stripe API 429s with exponential backoff", context: { api: "stripe" }, relevance: 0.38, compatible: false },
  { id: "exp_seed_shopify_bulk", problem: "Bulk-export Shopify orders with GraphQL bulk operations", context: { api: "shopify" }, relevance: 0.57, compatible: false },
  { id: "exp_seed_csv_dedupe", problem: "Deduplicate CSV rows by composite key", context: { format: "csv" }, relevance: 0.29, compatible: false },
  { id: "exp_seed_stream_json", problem: "Stream large JSON responses without buffering", context: { runtime: "python" }, relevance: 0.22, compatible: false },
  { id: "exp_seed_etag", problem: "Poll REST endpoints efficiently with ETag caching", context: { api: "generic-rest" }, relevance: 0.31, compatible: false },
  { id: "exp_seed_s3_resume", problem: "Resume interrupted S3 multipart uploads", context: { api: "s3" }, relevance: 0.12, compatible: false },
];

export interface StoryTaskSpec {
  id: string;
  title: string;
  brief: string;
  producer_id: string;
  experience_id: string;
  parent_experience_id: string | null;
  problem: string;
  teaser: string;
  result_summary: string;
  evaluator_label: string;
  tool_calls: MockToolCall[];
  metrics: Omit<RunMetrics, "tool_calls" | "failed_tool_calls">;
  baseline: RunMetrics | null;
}

export const STORY_TASKS: StoryTaskSpec[] = [
  {
    id: "task_1",
    title: "Export every order exactly once",
    brief: "Export every order exactly once from fixture A and show that the export is complete.",
    producer_id: "agent_a",
    experience_id: "exp_a",
    parent_experience_id: null,
    problem: "Export every record from a cursor-paginated API",
    teaser: "Offset paging repeats page one on this API; follow next_cursor until null and dedupe by id.",
    result_summary: "1,240 orders exported, 12 duplicate records removed, count verified against /orders/count.",
    evaluator_label: "Fixture evaluator passed: 1,240 / 1,240 orders, 0 duplicates",
    tool_calls: [
      { label: "GET /orders?limit=100", ok: true },
      { label: "GET /orders?offset=100: repeated first page", ok: false },
      { label: "GET /orders?page=2: repeated first page", ok: false },
      { label: "GET /orders?offset=200: repeated first page", ok: false },
      { label: "Inspect response: found next_cursor", ok: true },
      { label: "GET /orders?cursor=… (page 2)", ok: true },
      { label: "GET /orders?cursor=… (page 3)", ok: true },
      { label: "GET /orders?cursor=… (page 4): 429 Too Many Requests", ok: false },
      { label: "Retry page 4 after rate limit", ok: true },
      { label: "GET /orders?cursor=… (page 5)", ok: true },
      { label: "GET /orders?cursor=… (page 6)", ok: true },
      { label: "GET /orders?cursor=… (last page, next_cursor=null)", ok: true },
      { label: "Deduplicate by order id (12 removed)", ok: true },
      { label: "Verify count against /orders/count", ok: true },
    ],
    metrics: { tokens: 48_200, duration_ms: 96_000, compute_cost_usd: 0.41 },
    baseline: null,
  },
  {
    id: "task_2",
    title: "Reconcile orders with duplicates and rate limits",
    brief: "Reconcile all orders in fixture B, handling duplicate IDs and temporary rate limiting.",
    producer_id: "agent_b",
    experience_id: "exp_b",
    parent_experience_id: "exp_a",
    problem: "Reconcile a cursor-paginated export with duplicate ids and 429 rate limits",
    teaser: "Builds on exp_a: cursor paging plus Retry-After backoff, so rate limits never drop a page.",
    result_summary: "2,015 orders reconciled, 31 duplicates merged, one 429 absorbed by backoff.",
    evaluator_label: "Fixture evaluator passed: 2,015 / 2,015 orders reconciled",
    tool_calls: [
      { label: "GET /orders?limit=200 (cursor paging from exp_a)", ok: true },
      { label: "GET /orders?cursor=… (page 2)", ok: true },
      { label: "GET /orders?cursor=… (page 3): 429 Too Many Requests", ok: false },
      { label: "Back off per Retry-After, retry page 3", ok: true },
      { label: "GET /orders?cursor=… (last page)", ok: true },
      { label: "Merge 31 duplicates, verify totals", ok: true },
    ],
    metrics: { tokens: 17_900, duration_ms: 41_000, compute_cost_usd: 0.15 },
    baseline: { tool_calls: 17, failed_tool_calls: 5, tokens: 61_300, duration_ms: 128_000, compute_cost_usd: 0.52 },
  },
  {
    id: "task_3",
    title: "Incremental order sync",
    brief: "Sync new orders from fixture C into the warehouse table since the last checkpoint.",
    producer_id: "agent_c",
    experience_id: "exp_c",
    parent_experience_id: "exp_b",
    problem: "Incrementally sync a cursor-paginated API from a saved checkpoint",
    teaser: "Builds on exp_b: persist the last cursor as a checkpoint and resume from it with backoff.",
    result_summary: "312 new orders upserted; checkpoint advanced; no gaps or duplicates.",
    evaluator_label: "Fixture evaluator passed: 312 / 312 new orders, checkpoint advanced",
    tool_calls: [
      { label: "GET /orders?since=checkpoint", ok: true },
      { label: "GET /orders?cursor=… (page 2)", ok: true },
      { label: "GET /orders?cursor=… (last page)", ok: true },
      { label: "Upsert 312 orders into warehouse", ok: true },
      { label: "Verify checkpoint advanced", ok: true },
    ],
    metrics: { tokens: 14_100, duration_ms: 33_000, compute_cost_usd: 0.12 },
    baseline: null,
  },
];
