import { buildMockFeed } from "@token-origins/schema/mock";
import { describe, expect, test } from "vitest";
import { snapshotAt } from "./replay.ts";

const feed = buildMockFeed();
const indexOf = (predicate: (e: (typeof feed.events)[number]) => boolean) => feed.events.findIndex(predicate);

describe("snapshotAt", () => {
  test("cursor 0 shows nothing yet", () => {
    const snap = snapshotAt(feed, 0);
    expect(snap.current).toBeNull();
    expect(snap.published.size).toBe(0);
    expect(snap.receiptIds).toEqual([]);
    expect(snap.tasks.task_1?.stage).toBe("queued");
  });

  test("the full replay publishes every story experience and pays every allocation", () => {
    const snap = snapshotAt(feed, feed.events.length);
    expect([...snap.published].sort()).toEqual(["exp_a", "exp_b", "exp_c"]);
    expect(snap.paidAllocations.size).toBe(feed.allocations.length);
    expect(Object.values(snap.tasks).map((t) => t.stage)).toEqual(["published", "published", "published"]);
    expect(snap.paidTotal).toBe(feed.allocations.reduce((sum, a) => sum + BigInt(a.amount), 0n));
  });

  test("counts tool calls as they replay", () => {
    const firstFailure = indexOf((e) => e.kind === "tool_call" && !e.ok);
    const snap = snapshotAt(feed, firstFailure + 1);
    expect(snap.tasks.task_1).toMatchObject({ stage: "working", toolCalls: 2, failedToolCalls: 1 });
  });

  test("tracks an order from purchase to collection", () => {
    const locked = indexOf((e) => e.kind === "funds_locked");
    expect(snapshotAt(feed, locked + 1).orders.order_1).toBe("funds_locked");
    expect(snapshotAt(feed, locked + 1).tasks.task_2?.stage).toBe("buying");
    const collected = indexOf((e) => e.kind === "payment_collected" && e.order_id === "order_1");
    expect(snapshotAt(feed, collected + 1).orders.order_1).toBe("collected");
  });

  test("receipts appear newest first", () => {
    const snap = snapshotAt(feed, feed.events.length);
    expect(snap.receiptIds[0]).toBe(feed.events.findLast((e) => e.receipt_id)?.receipt_id);
    expect(new Set(snap.receiptIds).size).toBe(snap.receiptIds.length);
  });

  test("earnings accumulate per recipient", () => {
    const snap = snapshotAt(feed, feed.events.length);
    expect(snap.earnedByAgent.agent_a).toBe(950_000n + 190_000n);
    expect(snap.earnedByAgent.agent_b).toBe(760_000n);
  });

  test("clamps out-of-range cursors", () => {
    expect(snapshotAt(feed, -5).cursor).toBe(0);
    expect(snapshotAt(feed, 10_000).cursor).toBe(feed.events.length);
  });
});
