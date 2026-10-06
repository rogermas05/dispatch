// Replays the feed's event log up to a cursor and derives what the dashboard shows
// at that moment. Pure: the playback controls only move the cursor.
import type { Feed, FeedEvent } from "@token-origins/schema";

export type TaskStage = "queued" | "received" | "searched" | "buying" | "working" | "verified" | "delivered" | "published";
export type OrderStage = "placed" | "funds_locked" | "delivered" | "collected" | "allocated";

export const TASK_STAGES: TaskStage[] = ["received", "searched", "buying", "working", "verified", "delivered", "published"];

export interface TaskProgress {
  stage: TaskStage;
  toolCalls: number;
  failedToolCalls: number;
  lastToolLabel: string | null;
}

export interface Snapshot {
  cursor: number;
  current: FeedEvent | null;
  activeTaskId: string | null;
  registered: ReadonlySet<string>;
  published: ReadonlySet<string>;
  tasks: Readonly<Record<string, TaskProgress>>;
  orders: Readonly<Record<string, OrderStage>>;
  paidAllocations: ReadonlySet<string>;
  receiptIds: readonly string[];
  earnedByAgent: Readonly<Record<string, bigint>>;
  paidTotal: bigint;
}

const TASK_STAGE_BY_EVENT: Partial<Record<FeedEvent["kind"], TaskStage>> = {
  task_received: "received",
  search_completed: "searched",
  order_placed: "buying",
  tool_call: "working",
  result_evaluated: "verified",
  result_delivered: "delivered",
  experience_published: "published",
};

const ORDER_STAGE_BY_EVENT: Partial<Record<FeedEvent["kind"], OrderStage>> = {
  order_placed: "placed",
  funds_locked: "funds_locked",
  content_delivered: "delivered",
  payment_collected: "collected",
  royalty_allocated: "allocated",
};

export function snapshotAt(feed: Feed, rawCursor: number): Snapshot {
  const cursor = Math.max(0, Math.min(feed.events.length, Math.floor(rawCursor)));
  const applied = feed.events.slice(0, cursor);
  const allocationsById = new Map(feed.allocations.map((a) => [a.id, a]));

  const tasks: Record<string, TaskProgress> = Object.fromEntries(
    feed.tasks.map((t) => [t.id, { stage: "queued" as TaskStage, toolCalls: 0, failedToolCalls: 0, lastToolLabel: null }]),
  );
  const orders: Record<string, OrderStage> = {};
  const registered = new Set<string>();
  const published = new Set<string>();
  const paidAllocations = new Set<string>();
  const receiptIds: string[] = [];
  const earnedByAgent: Record<string, bigint> = {};
  let activeTaskId: string | null = null;

  for (const event of applied) {
    const taskStage = TASK_STAGE_BY_EVENT[event.kind];
    const task = event.task_id ? tasks[event.task_id] : undefined;
    if (event.task_id) activeTaskId = event.task_id;
    if (task && taskStage) {
      const isToolCall = event.kind === "tool_call";
      tasks[event.task_id!] = {
        stage: taskStage,
        toolCalls: task.toolCalls + (isToolCall ? 1 : 0),
        failedToolCalls: task.failedToolCalls + (isToolCall && !event.ok ? 1 : 0),
        lastToolLabel: isToolCall ? event.label : task.lastToolLabel,
      };
    }

    const orderStage = ORDER_STAGE_BY_EVENT[event.kind];
    if (event.order_id && orderStage) orders[event.order_id] = orderStage;
    if (event.kind === "agent_registered" && event.agent_id) registered.add(event.agent_id);
    if (event.kind === "experience_published" && event.experience_id) published.add(event.experience_id);
    if (event.kind === "payout_confirmed" && event.allocation_id) {
      const allocation = allocationsById.get(event.allocation_id);
      if (allocation && !paidAllocations.has(allocation.id)) {
        paidAllocations.add(allocation.id);
        earnedByAgent[allocation.recipient_id] = (earnedByAgent[allocation.recipient_id] ?? 0n) + BigInt(allocation.amount);
      }
    }
    if (event.receipt_id && !receiptIds.includes(event.receipt_id)) receiptIds.unshift(event.receipt_id);
  }

  return {
    cursor,
    current: applied.at(-1) ?? null,
    activeTaskId,
    registered,
    published,
    tasks,
    orders,
    paidAllocations,
    receiptIds,
    earnedByAgent,
    paidTotal: Object.values(earnedByAgent).reduce((sum, v) => sum + v, 0n),
  };
}
