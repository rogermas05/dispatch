import { buildMockFeed } from "@token-origins/schema/mock";
import { describe, expect, test } from "vitest";
import { tamper, verifyCommitment } from "./verify.ts";

const job = buildMockFeed().jobs[0]!;

describe("verifyCommitment", () => {
  test("recomputes the on-chain input hash from the job input", async () => {
    await expect(verifyCommitment(job.input, job.input_hash, job.identifier_from_purchaser)).resolves.toEqual({ computed: job.input_hash, matches: true });
  });

  test("recomputes the on-chain output hash from the delivered result", async () => {
    const result = await verifyCommitment(job.result, job.output_hash!, job.identifier_from_purchaser);
    expect(result.matches).toBe(true);
  });

  test("detects a single changed word in the transcript", async () => {
    const tampered = structuredClone(job.result!);
    tampered.transcript.turns[0]!.text += " (edited)";
    const result = await verifyCommitment(tampered, job.output_hash!, job.identifier_from_purchaser);
    expect(result.matches).toBe(false);
    expect(result.computed).not.toBe(job.output_hash);
  });
});

describe("agent hires (MIP-004)", () => {
  test("verifies the nonce-prefixed hashes of an agent-hired call", async () => {
    const agentJob = buildMockFeed().jobs.find((j) => j.identifier_from_purchaser)!;
    expect((await verifyCommitment(agentJob.input, agentJob.input_hash, agentJob.identifier_from_purchaser)).matches).toBe(true);
    expect((await verifyCommitment(agentJob.result, agentJob.output_hash!, agentJob.identifier_from_purchaser)).matches).toBe(true);
    expect((await verifyCommitment(agentJob.input, agentJob.input_hash, null)).matches).toBe(false);
  });
});

describe("tamper demo", () => {
  test.each(buildMockFeed().jobs.map((j) => [j.id, j]))("changing one digit breaks the output hash for %s", async (_, j) => {
    const edited = tamper(j.result!);
    expect(edited).not.toEqual(j.result);
    expect((await verifyCommitment(edited, j.output_hash!, j.identifier_from_purchaser)).matches).toBe(false);
  });
});
