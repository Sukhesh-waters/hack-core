import { describe, expect, it } from "vitest";
import {
  canCiteHypothesisAlone,
  checkSupport,
  emptyBuckets,
  labelBuckets,
  minNGate,
  type RetrievalBuckets,
} from "./retrieval";

const evidence = (n: number): RetrievalBuckets["evidence"] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    content: `e${i}`,
    plane: "A" as const,
  }));

const hypo = (
  n: number,
  generation = 0,
): RetrievalBuckets["hypotheses"] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    content: `h${i}`,
    plane: "C" as const,
    confidence: 0.8,
    generation,
  }));

describe("two-bucket retrieval", () => {
  it("keeps evidence and hypotheses as separate arrays", () => {
    const buckets = {
      evidence: evidence(2),
      hypotheses: hypo(1),
    };
    const labelled = labelBuckets(buckets);
    expect(labelled.evidence).toHaveLength(2);
    expect(labelled.hypotheses).toHaveLength(1);
    expect(labelled.evidenceLabel).toBe("our own data shows");
    expect(labelled.hypothesisLabel).toBe(
      "market pattern suggests, unvalidated",
    );
  });

  it("refuses a plane-C-only recommendation", () => {
    expect(
      checkSupport({ evidence: [], hypotheses: hypo(3) }).reason,
    ).toBe("plane_c_sole_support");
  });

  it("refuses gen>=2 as sole support", () => {
    expect(canCiteHypothesisAlone(2)).toBe(false);
    expect(canCiteHypothesisAlone(0)).toBe(true);
    expect(
      checkSupport({ evidence: [], hypotheses: hypo(2, 2) }).reason,
    ).toBe("compacted_sole_support");
  });

  it("honours the min-N honesty gate", () => {
    expect(minNGate(5).status).toBe("insufficient_baseline");
    expect(minNGate(20).status).toBe("ready");
    expect(checkSupport(emptyBuckets()).reason).toBe("insufficient_baseline");
  });

  it("accepts a mixed A+C recommendation", () => {
    expect(
      checkSupport({ evidence: evidence(3), hypotheses: hypo(2) }).ok,
    ).toBe(true);
  });
});
