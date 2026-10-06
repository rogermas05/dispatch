import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { canonicalize } from "./canonical.ts";
import { Feed } from "./feed.ts";
import { buildMockFeed } from "./mock/build.ts";

const mock = () => structuredClone(buildMockFeed());
const sha256 = (value: unknown) => createHash("sha256").update(canonicalize(value)).digest("hex");

describe("mock feed", () => {
  test("passes the feed schema and integrity checks", () => {
    expect(Feed.safeParse(mock()).error?.issues ?? []).toEqual([]);
  });

  test("is deterministic", () => {
    expect(buildMockFeed()).toEqual(buildMockFeed());
  });

  test("input and output hashes are real SHA-256 over the canonical JSON", () => {
    for (const job of mock().jobs) {
      expect(job.input_hash).toBe(sha256(job.input));
      expect(job.output_hash).toBe(sha256(job.result));
    }
  });

  test("replays every transcript turn exactly once, in order", () => {
    const feed = mock();
    for (const job of feed.jobs) {
      const turns = feed.events.filter((e) => e.kind === "transcript_turn" && e.job_id === job.id).map((e) => e.turn_index);
      expect(turns).toEqual(job.result!.transcript.turns.map((_, i) => i));
    }
  });

  test("funds lock before dialing, and collection waits for the dispute window", () => {
    const feed = mock();
    for (const job of feed.jobs) {
      const at = (kind: string) => Date.parse(feed.events.find((e) => e.kind === kind && e.job_id === job.id)!.at);
      expect(at("funds_locked")).toBeLessThan(at("dialing"));
      expect(at("result_submitted")).toBeLessThan(Date.parse(job.deadlines.submit_result_by));
      expect(at("payment_collected")).toBeGreaterThanOrEqual(Date.parse(job.deadlines.unlock_at));
    }
  });

  test("the agent hirer finds Dispatch in the registry and resumes its own task", () => {
    const feed = mock();
    const agentJob = feed.jobs.find((j) => feed.hirers.find((h) => h.id === j.hirer_id)?.kind === "agent")!;
    const kinds = feed.events.filter((e) => e.job_id === agentJob.id).map((e) => e.kind);
    expect(kinds[0]).toBe("registry_search");
    expect(kinds).toContain("hirer_resumed");
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
    expect(Feed.safeParse(feed).error?.issues.map((i) => i.message)).toContain("mock feeds may only contain mock receipts");
  });

  test("rejects a mock receipt that links to an explorer", () => {
    const feed = mock();
    feed.receipts[0]!.explorer_url = "https://preprod.cardanoscan.io/transaction/abc";
    expect(Feed.safeParse(feed).success).toBe(false);
  });

  test("rejects a dangling reference", () => {
    const feed = mock();
    feed.jobs[0]!.party_id = "nobody";
    expect(Feed.safeParse(feed).error?.issues.map((i) => i.message)).toContain('unknown party "nobody"');
  });

  test("rejects a transcript event pointing past the transcript", () => {
    const feed = mock();
    const turn = feed.events.find((e) => e.kind === "transcript_turn")!;
    turn.turn_index = 999;
    expect(Feed.safeParse(feed).success).toBe(false);
  });

  test("rejects a result without an output hash", () => {
    const feed = mock();
    feed.jobs[0]!.output_hash = null;
    expect(Feed.safeParse(feed).success).toBe(false);
  });

  test("rejects out-of-order event sequence numbers", () => {
    const feed = mock();
    feed.events[2]!.seq = 0;
    expect(Feed.safeParse(feed).success).toBe(false);
  });
});
