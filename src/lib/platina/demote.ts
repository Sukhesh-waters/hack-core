/**
 * Slow loop wins. A measured plane-A outcome that contradicts a Brain
 * hypothesis demotes it immediately, at any generation.
 */

export type OutcomeSignal = {
  topic: string;
  worked: boolean;
};

export type BrainHypothesis = {
  id: string;
  topic: string;
  generation: number;
  status: "active" | "demoted";
};

export function shouldDemote(
  outcome: OutcomeSignal,
  hypothesis: BrainHypothesis,
): boolean {
  if (hypothesis.status === "demoted") return false;
  return !outcome.worked && hypothesis.topic === outcome.topic;
}

export function applyDemotion(
  hypothesis: BrainHypothesis,
  outcome: OutcomeSignal,
): BrainHypothesis {
  if (!shouldDemote(outcome, hypothesis)) return hypothesis;
  return { ...hypothesis, status: "demoted" };
}

export function slowLoopOverridesFast(): true {
  return true;
}
