import { buildMockFeed } from "@token-origins/schema/mock";
import { describe, expect, test } from "vitest";
import { snapshotAt } from "./replay.ts";

const feed = buildMockFeed();
const indexOf = (predicate: (e: (typeof feed.events)[number]) => boolean) => feed.events.findIndex(predicate);
const after = (predicate: (e: (typeof feed.events)[number]) => boolean) => snapshotAt(feed, indexOf(predicate) + 1);

describe("snapshotAt", () => {
  test("cursor 0 shows nothing yet", () => {
    const snap = snapshotAt(feed, 0);
    expect(snap.current).toBeNull();
    expect(snap.registered).toBe(false);
    expect(snap.receiptIds).toEqual([]);
    expect(snap.jobs.job_1?.stage).toBe("queued");
  });

  test("the full replay completes and collects every job", () => {
    const snap = snapshotAt(feed, feed.events.length);
    expect(Object.values(snap.jobs).map((j) => j.stage)).toEqual(["collected", "collected"]);
    expect(snap.collectedTotal).toBe(1_500_000n);
    expect(snap.lockedTotal).toBe(0n);
    expect(snap.callsCompleted).toBe(2);
    expect(snap.commitments).toBe(4);
  });

  test("reveals transcript turns one by one", () => {
    const snap = after((e) => e.kind === "transcript_turn" && e.job_id === "job_1" && e.turn_index === 2);
    expect(snap.jobs.job_1).toMatchObject({ stage: "on_call", turnsShown: 3 });
  });

  test("tracks a hold while it is the latest event for the job", () => {
    const snap = after((e) => e.kind === "on_hold" && e.job_id === "job_1");
    expect(snap.jobs.job_1?.holdSeconds).toBeGreaterThan(20 * 60);
    expect(snap.holdAbsorbedSeconds).toBe(snap.jobs.job_1?.holdSeconds);
    const next = snapshotAt(feed, snap.cursor + 1);
    expect(next.jobs.job_1?.holdSeconds).toBeNull();
  });

  test("funds stay locked until collection", () => {
    const locked = after((e) => e.kind === "funds_locked" && e.job_id === "job_1");
    expect(locked.lockedTotal).toBe(1_000_000n);
    expect(locked.jobs.job_1?.stage).toBe("funds_locked");
    const collected = after((e) => e.kind === "payment_collected" && e.job_id === "job_1");
    expect(collected.jobs.job_1?.stage).toBe("collected");
  });

  test("an agent hirer starts by searching the registry", () => {
    expect(after((e) => e.kind === "registry_search").jobs.job_2?.stage).toBe("searching");
    expect(after((e) => e.kind === "hirer_resumed").jobs.job_2?.hirerResumed).toBe(true);
  });

  test("receipts appear newest first without duplicates", () => {
    const snap = snapshotAt(feed, feed.events.length);
    expect(snap.receiptIds[0]).toBe(feed.events.findLast((e) => e.receipt_id)?.receipt_id);
    expect(new Set(snap.receiptIds).size).toBe(snap.receiptIds.length);
  });

  test("clamps out-of-range cursors", () => {
    expect(snapshotAt(feed, -5).cursor).toBe(0);
    expect(snapshotAt(feed, 10_000).cursor).toBe(feed.events.length);
  });
});
