// Ranking score from SPEC.md §10. Every component is normalized to [0, 1].

export const SCORE_WEIGHTS = {
  relevance: 0.45,
  context_match: 0.2,
  observed_success: 0.15,
  evidence_quality: 0.1,
  freshness: 0.05,
  creator_reliability: 0.05,
} as const;

export type ScoreComponentName = keyof typeof SCORE_WEIGHTS;
export type EvidenceLevelName = "self_report" | "artifact" | "evaluator";

const EVIDENCE_QUALITY: Record<EvidenceLevelName, number> = { self_report: 0.2, artifact: 0.5, evaluator: 1 };

export function rankScore(components: Record<ScoreComponentName, number>): number {
  return (Object.keys(SCORE_WEIGHTS) as ScoreComponentName[]).reduce(
    (sum, name) => sum + SCORE_WEIGHTS[name] * components[name],
    0,
  );
}

/** Smoothed success rate with a neutral cold-start prior: (successes + 2) / (trials + 4). */
export function observedSuccess(successes: number, trials: number): number {
  if (successes < 0 || trials < 0 || successes > trials) {
    throw new Error(`invalid outcome counts: ${successes} successes in ${trials} trials`);
  }
  return (successes + 2) / (trials + 4);
}

export function evidenceQuality(level: EvidenceLevelName): number {
  return EVIDENCE_QUALITY[level];
}
