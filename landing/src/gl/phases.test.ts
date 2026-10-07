import { expect, test } from "vitest";
import { isPhaseName, mixParams, phaseParams, PHASES } from "./phases";

test("mixParams returns the endpoints at t=0 and t=1", () => {
  expect(mixParams(PHASES.hero, PHASES.orb, 0)).toEqual(PHASES.hero);
  expect(mixParams(PHASES.hero, PHASES.orb, 1)).toEqual(PHASES.orb);
});

test("mixParams blends every channel, including colour", () => {
  const mid = mixParams(PHASES.hero, PHASES.orb, 0.5);
  expect(mid.ring).toBe(0.5);
  expect(mid.colB[0]).toBeCloseTo((PHASES.hero.colB[0] + PHASES.orb.colB[0]) / 2);
});

test("isPhaseName only accepts known phases", () => {
  expect(isPhaseName("ledger")).toBe(true);
  expect(isPhaseName("nope")).toBe(false);
  expect(isPhaseName(undefined)).toBe(false);
});

test("phaseParams lifts the hero wave on portrait screens only", () => {
  expect(phaseParams("hero", false)).toEqual(PHASES.hero);
  expect(phaseParams("hero", true).y).toBeGreaterThan(PHASES.hero.y);
  expect(phaseParams("orb", true)).toEqual(PHASES.orb);
});
