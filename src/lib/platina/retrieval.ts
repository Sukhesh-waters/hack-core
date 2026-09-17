/**
 * Two-bucket retrieval. Returns evidence (plane A) and hypotheses (plane C)
 * as separate arrays. There is no merge helper.
 */

export const DEFAULT_MIN_BASELINE_N = 20;

export type EvidenceChunk = {
  id: string;
  content: string;
  plane: "A";
};

export type HypothesisChunk = {
  id: string;
  content: string;
  plane: "C";
  confidence: number;
  generation: number;
};

export type RetrievalBuckets = {
  evidence: EvidenceChunk[];
  hypotheses: HypothesisChunk[];
};

export type SupportCheck =
  | { ok: true }
  | { ok: false; reason: "plane_c_sole_support" | "compacted_sole_support" | "insufficient_baseline" };

export function emptyBuckets(): RetrievalBuckets {
  return { evidence: [], hypotheses: [] };
}

/** Never merge the buckets. Callers must consume them separately. */
export function labelBuckets(buckets: RetrievalBuckets): {
  evidenceLabel: "our own data shows";
  hypothesisLabel: "market pattern suggests, unvalidated";
  evidence: EvidenceChunk[];
  hypotheses: HypothesisChunk[];
} {
  return {
    evidenceLabel: "our own data shows",
    hypothesisLabel: "market pattern suggests, unvalidated",
    evidence: buckets.evidence,
    hypotheses: buckets.hypotheses,
  };
}

/**
 * Support shape only — whether what we hold may be cited at all. Sample size
 * is a separate question, answered by minNGate: a recommendation can be
 * properly anchored in plane A and still be below the baseline threshold.
 */
export function checkSupport(buckets: RetrievalBuckets): SupportCheck {
  if (buckets.evidence.length > 0) return { ok: true };
  if (buckets.hypotheses.length === 0) {
    return { ok: false, reason: "insufficient_baseline" };
  }
  // Report the stricter refusal first: a compacted chunk is a summary of
  // summaries, so it is even further from evidence than a gen-0 hypothesis.
  if (buckets.hypotheses.every((h) => !canCiteHypothesisAlone(h.generation))) {
    return { ok: false, reason: "compacted_sole_support" };
  }
  return { ok: false, reason: "plane_c_sole_support" };
}

export function canCiteHypothesisAlone(generation: number): boolean {
  return generation < 2;
}

export const DEFAULT_SIMILARITY_FLOOR = 0.35;

/**
 * R4.2 — relevance is a separate question from baseline size. A workspace
 * can hold hundreds of qualifying records and still retrieve nothing
 * relevant to the question. The floor passes when either channel has real
 * signal: a vector hit at or above the floor, or an exact lexical hit (the
 * model-number case R4.4 exists for). Both weak → insufficient_relevance,
 * which tells the operator "the question does not match the evidence" —
 * a different action from "more data is needed" (insufficient_baseline).
 */
export function relevanceGate(
  input: { bestVectorScore: number | null; hasLexicalHit: boolean },
  floor = DEFAULT_SIMILARITY_FLOOR,
): { status: "ready" } | { status: "insufficient_relevance"; bestScore: number | null } {
  if (input.bestVectorScore !== null && input.bestVectorScore >= floor) {
    return { status: "ready" };
  }
  if (input.hasLexicalHit) return { status: "ready" };
  return { status: "insufficient_relevance", bestScore: input.bestVectorScore };
}

export function minNGate(
  sampleSize: number,
  minN = DEFAULT_MIN_BASELINE_N,
): { status: "ready" } | { status: "insufficient_baseline"; sampleSize: number } {
  if (sampleSize < minN) {
    return { status: "insufficient_baseline", sampleSize };
  }
  return { status: "ready" };
}
