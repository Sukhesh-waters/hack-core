import { describe, expect, it } from "vitest";
import {
  canCiteHypothesisAlone,
  checkSupport,
  emptyBuckets,
  labelBuckets,
  minNGate,
  relevanceGate,
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

/** Fails loudly if support was granted, so a pass can only mean a refusal. */
const refusalReason = (buckets: RetrievalBuckets) => {
  const result = checkSupport(buckets);
  if (result.ok) throw new Error("expected a refusal, support was granted");
  return result.reason;
};

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
    expect(refusalReason({ evidence: [], hypotheses: hypo(3) })).toBe(
      "plane_c_sole_support",
    );
  });

  it("refuses gen>=2 as sole support", () => {
    expect(canCiteHypothesisAlone(2)).toBe(false);
    expect(canCiteHypothesisAlone(0)).toBe(true);
    expect(refusalReason({ evidence: [], hypotheses: hypo(2, 2) })).toBe(
      "compacted_sole_support",
    );
  });

  it("still names plane-C sole support when a gen-0 hypothesis is in the mix", () => {
    expect(
      refusalReason({
        evidence: [],
        hypotheses: [...hypo(1, 0), ...hypo(1, 2)],
      }),
    ).toBe("plane_c_sole_support");
  });

  it("honours the min-N honesty gate", () => {
    expect(minNGate(5).status).toBe("insufficient_baseline");
    expect(minNGate(20).status).toBe("ready");
    expect(refusalReason(emptyBuckets())).toBe("insufficient_baseline");
  });

  it("distinguishes insufficient relevance from insufficient baseline (R4.2)", () => {
    // Baseline is about SIZE; relevance is about the QUESTION matching.
    expect(
      relevanceGate({ bestVectorScore: 0.8, hasLexicalHit: false }, 0.35)
        .status,
    ).toBe("ready");
    expect(
      relevanceGate({ bestVectorScore: 0.2, hasLexicalHit: false }, 0.35),
    ).toEqual({ status: "insufficient_relevance", bestScore: 0.2 });
    // An exact lexical hit is relevance evidence even with weak vectors —
    // the model-number case R4.4 exists for.
    expect(
      relevanceGate({ bestVectorScore: 0.2, hasLexicalHit: true }, 0.35)
        .status,
    ).toBe("ready");
    // No vectors at all (embed outage) with no lexical hit → not relevant.
    expect(
      relevanceGate({ bestVectorScore: null, hasLexicalHit: false }, 0.35)
        .status,
    ).toBe("insufficient_relevance");
  });

  it("accepts a mixed A+C recommendation", () => {
    expect(
      checkSupport({ evidence: evidence(3), hypotheses: hypo(2) }).ok,
    ).toBe(true);
  });
});
