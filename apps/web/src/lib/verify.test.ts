import { buildMockFeed } from "@token-origins/schema/mock";
import { describe, expect, test } from "vitest";
import { tamper, verifyCommitment } from "./verify.ts";

const job = buildMockFeed().jobs[0]!;

describe("verifyCommitment", () => {
  test("recomputes the on-chain input hash from the job input", async () => {
    await expect(verifyCommitment(job.input, job.input_hash)).resolves.toEqual({ computed: job.input_hash, matches: true });
  });

  test("recomputes the on-chain output hash from the delivered result", async () => {
    const result = await verifyCommitment(job.result, job.output_hash!);
    expect(result.matches).toBe(true);
  });

  test("detects a single changed word in the transcript", async () => {
    const tampered = structuredClone(job.result!);
    tampered.transcript.turns[0]!.text += " (edited)";
    const result = await verifyCommitment(tampered, job.output_hash!);
    expect(result.matches).toBe(false);
    expect(result.computed).not.toBe(job.output_hash);
  });
});

describe("tamper demo", () => {
  test.each(buildMockFeed().jobs.map((j) => [j.id, j]))("changing one digit breaks the output hash for %s", async (_, j) => {
    const edited = tamper(j.result!);
    expect(edited).not.toEqual(j.result);
    expect((await verifyCommitment(edited, j.output_hash!)).matches).toBe(false);
  });
});
