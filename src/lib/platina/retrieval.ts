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

export function minNGate(
  sampleSize: number,
  minN = DEFAULT_MIN_BASELINE_N,
): { status: "ready" } | { status: "insufficient_baseline"; sampleSize: number } {
  if (sampleSize < minN) {
    return { status: "insufficient_baseline", sampleSize };
  }
  return { status: "ready" };
}
