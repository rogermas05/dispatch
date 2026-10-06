import { describe, expect, test } from "vitest";
import { evidenceQuality, observedSuccess, rankScore, SCORE_WEIGHTS } from "./scoring.ts";

describe("rankScore", () => {
  test("weights total exactly 1", () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  test("applies the SPEC §10 weights", () => {
    const score = rankScore({
      relevance: 1,
      context_match: 0.5,
      observed_success: 0.5,
      evidence_quality: 1,
      freshness: 1,
      creator_reliability: 0.5,
    });
    expect(score).toBeCloseTo(0.45 + 0.1 + 0.075 + 0.1 + 0.05 + 0.025, 10);
  });
});

describe("observedSuccess", () => {
  test("gives a neutral 0.5 prior with no trials", () => {
    expect(observedSuccess(0, 0)).toBe(0.5);
  });

  test("smooths small samples toward the prior", () => {
    expect(observedSuccess(1, 1)).toBeCloseTo(0.6, 10);
  });

  test("rejects more successes than trials", () => {
    expect(() => observedSuccess(3, 2)).toThrow();
  });
});

describe("evidenceQuality", () => {
  test("maps evidence levels to SPEC §10 values", () => {
    expect(evidenceQuality("self_report")).toBe(0.2);
    expect(evidenceQuality("artifact")).toBe(0.5);
    expect(evidenceQuality("evaluator")).toBe(1);
  });
});
