import { describe, expect, test } from "vitest";
import { Feed } from "./feed.ts";
import { buildMockFeed } from "./mock/build.ts";

const mock = () => structuredClone(buildMockFeed());

describe("mock feed", () => {
  test("passes the feed schema and integrity checks", () => {
    const result = Feed.safeParse(mock());
    expect(result.error?.issues ?? []).toEqual([]);
  });

  test("is deterministic", () => {
    expect(buildMockFeed()).toEqual(buildMockFeed());
  });

  test("task metrics match the replayed tool-call events", () => {
    const feed = mock();
    for (const task of feed.tasks) {
      const calls = feed.events.filter((e) => e.kind === "tool_call" && e.task_id === task.id);
      expect(calls.length).toBe(task.metrics.tool_calls);
      expect(calls.filter((e) => !e.ok).length).toBe(task.metrics.failed_tool_calls);
    }
  });

  test("every collected order's fee plus allocations equals the collected amount", () => {
    const feed = mock();
    for (const order of feed.orders) {
      const allocated = feed.allocations
        .filter((a) => a.order_id === order.id)
        .reduce((sum, a) => sum + BigInt(a.amount), BigInt(order.platform_fee ?? "0"));
      expect(allocated.toString()).toBe(order.collected_amount);
    }
  });

  test("tells the A → B → C story with the spec's royalty split", () => {
    const feed = mock();
    const exp = (id: string) => feed.experiences.find((e) => e.id === id)!;
    expect(exp("exp_a").parents).toEqual([]);
    expect(exp("exp_b").parents.map((p) => p.experience_id)).toEqual(["exp_a"]);
    expect(exp("exp_c").split).toEqual([
      { recipient_id: "agent_c", bps: 8000 },
      { recipient_id: "agent_b", bps: 1600 },
      { recipient_id: "agent_a", bps: 400 },
    ]);
    expect(feed.tasks.map((t) => t.search.decision)).toEqual(["cold_start", "purchase", "purchase"]);
  });

  test("events are chronological", () => {
    const times = mock().events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("feed integrity rules", () => {
  test("rejects a verified receipt inside a mock feed", () => {
    const feed = mock();
    feed.receipts[0]!.verification = "verified";
    const result = Feed.safeParse(feed);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain("mock feeds may only contain mock receipts");
  });

  test("rejects a mock receipt that links to an explorer", () => {
    const feed = mock();
    feed.receipts[0]!.explorer_url = "https://preprod.cardanoscan.io/transaction/abc";
    expect(Feed.safeParse(feed).success).toBe(false);
  });

  test("rejects a dangling reference", () => {
    const feed = mock();
    feed.orders[0]!.experience_id = "exp_missing";
    const result = Feed.safeParse(feed);
    expect(result.error?.issues.map((i) => i.message)).toContain('unknown experience "exp_missing"');
  });

  test("rejects out-of-order event sequence numbers", () => {
    const feed = mock();
    feed.events[2]!.seq = 0;
    expect(Feed.safeParse(feed).success).toBe(false);
  });

  test("rejects a split that does not total 10000 bps", () => {
    const feed = mock();
    feed.experiences[0]!.split = [{ recipient_id: feed.experiences[0]!.creator_id, bps: 9000 }];
    expect(Feed.safeParse(feed).success).toBe(false);
  });
});
