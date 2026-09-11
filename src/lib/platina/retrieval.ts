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

export function checkSupport(
  buckets: RetrievalBuckets,
  minN = DEFAULT_MIN_BASELINE_N,
): SupportCheck {
  if (buckets.evidence.length < minN && buckets.evidence.length === 0) {
    if (buckets.hypotheses.length > 0) {
      return { ok: false, reason: "plane_c_sole_support" };
    }
    return { ok: false, reason: "insufficient_baseline" };
  }
  if (buckets.evidence.length === 0 && buckets.hypotheses.length > 0) {
    return { ok: false, reason: "plane_c_sole_support" };
  }
  const onlyCompacted =
    buckets.evidence.length === 0 &&
    buckets.hypotheses.length > 0 &&
    buckets.hypotheses.every((h) => h.generation >= 2);
  if (onlyCompacted) {
    return { ok: false, reason: "compacted_sole_support" };
  }
  if (
    buckets.evidence.length === 0 &&
    buckets.hypotheses.some((h) => h.generation >= 2) &&
    buckets.hypotheses.every((h) => h.generation >= 2)
  ) {
    return { ok: false, reason: "compacted_sole_support" };
  }
  return { ok: true };
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
