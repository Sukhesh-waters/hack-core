import { describe, expect, it } from "vitest";
import {
  type Candidate,
  capDerived,
  derivedOnlySupport,
  diversifyEvidence,
  dropLineageDuplicates,
  lineageConflict,
  mmr,
  pickDisconfirming,
} from "./diversify";

const cand = (over: Partial<Candidate> & { id: string; relevance: number; content: string }): Candidate => ({
  derived: false,
  plane: "A",
  ...over,
});

describe("mmr", () => {
  it("removes a near-duplicate in favor of a diverse item", () => {
    // A is the clear leader. B is a near-duplicate of A's words (Jaccard
    // 0.8) with a modest relevance edge over C; C is topically disjoint from
    // both. At k=2, lambda=0.7, the diversity penalty on B should flip the
    // order relative to plain relevance ranking.
    const a = cand({ id: "a", relevance: 0.9, content: "alpha beta gamma delta" });
    const b = cand({ id: "b", relevance: 0.6, content: "alpha beta gamma delta epsilon" });
    const c = cand({ id: "c", relevance: 0.55, content: "zulu yankee xray whiskey" });

    const pureRelevanceOrder = [a, b, c].sort((x, y) => y.relevance - x.relevance).slice(0, 2);
    expect(pureRelevanceOrder.map((x) => x.id)).toEqual(["a", "b"]);

    const diversified = mmr([a, b, c], 2, 0.7);
    expect(diversified.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("keeps diverse items distinct from each other", () => {
    const a = cand({ id: "a", relevance: 0.9, content: "alpha beta gamma delta" });
    const c = cand({ id: "c", relevance: 0.55, content: "zulu yankee xray whiskey" });
    const d = cand({ id: "d", relevance: 0.5, content: "mango papaya guava lychee" });
    const result = mmr([a, c, d], 3, 0.7);
    expect(result.map((x) => x.id).sort()).toEqual(["a", "c", "d"]);
  });

  it("at lambda=1 equals a stable sort by relevance, ties broken by original position", () => {
    const x = cand({ id: "x", relevance: 0.5, content: "" });
    const y = cand({ id: "y", relevance: 0.8, content: "" });
    const z = cand({ id: "z", relevance: 0.8, content: "" });
    const w = cand({ id: "w", relevance: 0.3, content: "" });
    const result = mmr([x, y, z, w], 4, 1);
    expect(result.map((i) => i.id)).toEqual(["y", "z", "x", "w"]);
  });

  it("returns an empty array for k<=0 or no candidates", () => {
    const a = cand({ id: "a", relevance: 0.9, content: "alpha" });
    expect(mmr([a], 0)).toEqual([]);
    expect(mmr([], 3)).toEqual([]);
  });
});

describe("capDerived", () => {
  const tokensOf = (c: Candidate) => ({ d1: 100, d2: 100, d3: 300, big1: 200, big2: 200 } as Record<string, number>)[c.id] ?? 0;

  it("cold start: keeps derived items up to the cap even with no first-party items present", () => {
    const d1 = cand({ id: "d1", relevance: 0.9, content: "", derived: true, plane: "B" });
    const d2 = cand({ id: "d2", relevance: 0.8, content: "", derived: true, plane: "B" });
    // budget 1000 * share 0.4 = cap 400; d1+d2 = 200 <= 400, both survive.
    const kept = capDerived([d1, d2], { evidenceTokenBudget: 1000, derivedShare: 0.4, tokensOf });
    expect(kept.map((c) => c.id).sort()).toEqual(["d1", "d2"]);
  });

  it("drops whole derived chunks, lowest relevance first, until the derived total fits", () => {
    const d1 = cand({ id: "d1", relevance: 0.9, content: "", derived: true, plane: "B" }); // 100
    const d2 = cand({ id: "d2", relevance: 0.8, content: "", derived: true, plane: "B" }); // 100
    const d3 = cand({ id: "d3", relevance: 0.5, content: "", derived: true, plane: "B" }); // 300
    // total 500 > cap 400 (1000*0.4) -> drop d3 (lowest relevance) -> total 200, fits.
    const kept = capDerived([d1, d2, d3], { evidenceTokenBudget: 1000, derivedShare: 0.4, tokensOf });
    expect(kept.map((c) => c.id).sort()).toEqual(["d1", "d2"]);
  });

  it("the exact boundary (total === cap) is kept, not dropped", () => {
    const big1 = cand({ id: "big1", relevance: 0.9, content: "", derived: true, plane: "B" }); // 200
    const big2 = cand({ id: "big2", relevance: 0.8, content: "", derived: true, plane: "B" }); // 200
    // cap = 1000*0.4 = 400; total = 400 exactly.
    const kept = capDerived([big1, big2], { evidenceTokenBudget: 1000, derivedShare: 0.4, tokensOf });
    expect(kept.map((c) => c.id).sort()).toEqual(["big1", "big2"]);
  });

  it("never touches first-party (non-derived) items, even while dropping a derived one", () => {
    const fp = cand({ id: "fp", relevance: 0.1, content: "", derived: false, plane: "A" });
    const d1 = cand({ id: "d1", relevance: 0.9, content: "", derived: true, plane: "B" }); // 100
    const d3 = cand({ id: "d3", relevance: 0.5, content: "", derived: true, plane: "B" }); // 300
    // cap = 900*0.4 = 360; d1+d3 = 400 > 360 -> drop d3 (lowest relevance).
    const kept = capDerived([fp, d1, d3], { evidenceTokenBudget: 900, derivedShare: 0.4, tokensOf });
    expect(kept.map((c) => c.id).sort()).toEqual(["d1", "fp"]);
  });
});

describe("pickDisconfirming", () => {
  const base = { subjectKey: "s1", direction: "up" as const };

  it("prefers the most relevant ACTIVE chunk with the opposite direction", () => {
    const opposite1 = cand({ id: "o1", relevance: 0.5, content: "", derived: true, plane: "B", subjectKey: "s1", direction: "down", status: "active" });
    const opposite2 = cand({ id: "o2", relevance: 0.8, content: "", derived: true, plane: "B", subjectKey: "s1", direction: "down", status: "active" });
    const refuted = cand({ id: "r1", relevance: 0.95, content: "", derived: true, plane: "B", subjectKey: "s1", gradeState: "refuted" });
    const pick = pickDisconfirming(base, [opposite1, opposite2, refuted], []);
    // Opposite-active beats refuted even though refuted has higher relevance.
    expect(pick).toBe(opposite2);
  });

  it("falls back to the most relevant REFUTED chunk when no opposite-active exists", () => {
    const sameDirection = cand({ id: "same", relevance: 0.9, content: "", derived: true, plane: "B", subjectKey: "s1", direction: "up", status: "active" });
    const refutedLow = cand({ id: "rLow", relevance: 0.3, content: "", derived: true, plane: "B", subjectKey: "s1", gradeState: "refuted" });
    const refutedHigh = cand({ id: "rHigh", relevance: 0.6, content: "", derived: true, plane: "B", subjectKey: "s1", gradeState: "refuted" });
    const pick = pickDisconfirming(base, [sameDirection, refutedLow, refutedHigh], []);
    expect(pick).toBe(refutedHigh);
  });

  it("returns null when nothing on the subject qualifies", () => {
    const unrelated = cand({ id: "u", relevance: 0.9, content: "", derived: true, plane: "B", subjectKey: "other", direction: "down", status: "active" });
    expect(pickDisconfirming(base, [unrelated], [])).toBeNull();
  });

  it("returns null when leading has no subjectKey", () => {
    const opposite = cand({ id: "o", relevance: 0.9, content: "", derived: true, plane: "B", subjectKey: "s1", direction: "down", status: "active" });
    expect(pickDisconfirming({ subjectKey: null, direction: "up" }, [opposite], [])).toBeNull();
  });

  it("never picks an already-selected chunk", () => {
    const opposite = cand({ id: "o", relevance: 0.9, content: "", derived: true, plane: "B", subjectKey: "s1", direction: "down", status: "active" });
    const refuted = cand({ id: "r", relevance: 0.5, content: "", derived: true, plane: "B", subjectKey: "s1", gradeState: "refuted" });
    // "o" is already selected -> falls through to the refuted chunk, not null.
    const pick = pickDisconfirming(base, [opposite, refuted], ["o"]);
    expect(pick).toBe(refuted);
  });

  it("a demoted/non-active chunk on the opposite direction does not count as priority 1", () => {
    const demotedOpposite = cand({ id: "d", relevance: 0.99, content: "", derived: true, plane: "B", subjectKey: "s1", direction: "down", status: "demoted" });
    const refuted = cand({ id: "r", relevance: 0.2, content: "", derived: true, plane: "B", subjectKey: "s1", gradeState: "refuted" });
    const pick = pickDisconfirming(base, [demotedOpposite, refuted], []);
    expect(pick).toBe(refuted);
  });
});

describe("lineageConflict / dropLineageDuplicates", () => {
  it("conflicts when one chunk absorbed the other", () => {
    const a = cand({ id: "a", relevance: 0.9, content: "", lineage: { sourceSignalIds: [], absorbedChunkIds: ["b"] } });
    const b = cand({ id: "b", relevance: 0.5, content: "" });
    expect(lineageConflict(a, b)).toBe(true);
    expect(lineageConflict(b, a)).toBe(true);
  });

  it("conflicts when source-signal lineage overlaps", () => {
    const a = cand({ id: "a", relevance: 0.9, content: "", lineage: { sourceSignalIds: ["sig1", "sig2"], absorbedChunkIds: [] } });
    const b = cand({ id: "b", relevance: 0.5, content: "", lineage: { sourceSignalIds: ["sig2", "sig3"], absorbedChunkIds: [] } });
    expect(lineageConflict(a, b)).toBe(true);
  });

  it("no conflict with disjoint lineage, and never conflicts with itself", () => {
    const a = cand({ id: "a", relevance: 0.9, content: "", lineage: { sourceSignalIds: ["sig1"], absorbedChunkIds: [] } });
    const b = cand({ id: "b", relevance: 0.5, content: "", lineage: { sourceSignalIds: ["sig9"], absorbedChunkIds: [] } });
    expect(lineageConflict(a, b)).toBe(false);
    expect(lineageConflict(a, a)).toBe(false);
  });

  it("keeps the higher-relevance chunk of a conflicting pair", () => {
    const a = cand({ id: "a", relevance: 0.9, content: "", lineage: { sourceSignalIds: [], absorbedChunkIds: ["b"] } });
    const b = cand({ id: "b", relevance: 0.95, content: "" });
    const c = cand({ id: "c", relevance: 0.1, content: "" });
    const kept = dropLineageDuplicates([a, b, c]);
    // a absorbed b, so only one of {a,b} may survive; b has higher relevance.
    expect(kept.map((x) => x.id)).toEqual(["b", "c"]);
  });
});

describe("derivedOnlySupport", () => {
  it("is true when no id is a signal span or first-party id", () => {
    expect(derivedOnlySupport(["brain:1", "brain:2"])).toBe(true);
  });

  it("is false once a sig: or fp: id is present", () => {
    expect(derivedOnlySupport(["sig:doc1#e3", "brain:1"])).toBe(false);
    expect(derivedOnlySupport(["fp:page1", "brain:1"])).toBe(false);
  });

  it("is vacuously true for an empty support list", () => {
    expect(derivedOnlySupport([])).toBe(true);
  });
});

describe("diversifyEvidence", () => {
  const SIZE: Record<string, number> = {
    fp1: 100,
    fp2: 100,
    d1: 700,
    d2: 700,
    d3: 600,
    opp1: 50,
    refuted1: 50,
  };
  const tokensOf = (c: Candidate) => SIZE[c.id] ?? 0;

  function buildPool(): Candidate[] {
    return [
      cand({ id: "fp1", relevance: 0.95, content: "apple banana cherry orange", derived: false, plane: "A" }),
      cand({ id: "fp2", relevance: 0.9, content: "melon grape raisin walnut", derived: false, plane: "A" }),
      cand({
        id: "d1",
        relevance: 0.85,
        content: "golf hotel india juliet",
        derived: true,
        plane: "B",
        subjectKey: "s1",
        direction: "up",
        status: "active",
        lineage: { sourceSignalIds: ["sigA"], absorbedChunkIds: [] },
      }),
      cand({
        id: "d2",
        relevance: 0.8,
        content: "kilo lima mike november",
        derived: true,
        plane: "B",
        subjectKey: "s1",
        direction: "up",
        status: "active",
        lineage: { sourceSignalIds: ["sigA"], absorbedChunkIds: [] },
      }),
      cand({
        id: "d3",
        relevance: 0.6,
        content: "oscar papa quebec romeo",
        derived: true,
        plane: "B",
        subjectKey: "s1",
        direction: "up",
        status: "active",
      }),
      cand({
        id: "opp1",
        relevance: 0.55,
        content: "sierra tango uniform victor",
        derived: true,
        plane: "B",
        subjectKey: "s1",
        direction: "down",
        status: "active",
      }),
      cand({
        id: "refuted1",
        relevance: 0.4,
        content: "whiskey xray yankee zulu",
        derived: true,
        plane: "B",
        subjectKey: "s1",
        gradeState: "refuted",
        status: "demoted",
      }),
    ];
  }

  it("composes MMR, lineage dedup, the derived cap and the disconfirming slot; stats add up", () => {
    const candidates = buildPool();
    const result = diversifyEvidence({
      candidates,
      k: 4,
      evidenceTokenBudget: 2000, // derived cap = 800; d1 (700) fits
      derivedShare: 0.4,
      tokensOf,
    });

    // Support: fp1, fp2, d1 survive (d2 dropped by lineage conflict with d1;
    // d3/opp1/refuted1 never made the top-4 by relevance). Plus one
    // disconfirming slot: opp1 (opposite direction, active, on d1's subject).
    const ids = result.items.map((i) => `${i.role}:${i.candidate.id}`).sort();
    expect(ids).toEqual(["disconfirming:opp1", "support:d1", "support:fp1", "support:fp2"]);

    expect(result.stats.candidates).toBe(7);
    expect(result.stats.kept).toBe(result.items.length);
    expect(result.stats.kept).toBe(4);
    expect(result.stats.lineageDropped).toBe(1); // d2 dropped against d1
    expect(result.stats.nearDuplicatesDropped).toBe(0); // disjoint vocab, no diversity displacement
    expect(result.stats.disconfirmingFilled).toBe(true);

    const expectedEvidenceTokens = 100 + 100 + 700 + 50; // fp1 + fp2 + d1 + opp1
    const expectedDerivedTokens = 700 + 50; // d1 + opp1 (both derived)
    expect(result.stats.evidenceTokens).toBe(expectedEvidenceTokens);
    expect(result.stats.derivedTokens).toBe(expectedDerivedTokens);
    expect(result.stats.derivedShare).toBeCloseTo(expectedDerivedTokens / expectedEvidenceTokens, 10);
  });

  it("never mixes or relabels planes: the disconfirming item keeps its own plane and is the same object", () => {
    const candidates = buildPool();
    const result = diversifyEvidence({ candidates, k: 4, evidenceTokenBudget: 2000, derivedShare: 0.4, tokensOf });
    const disconfirming = result.items.find((i) => i.role === "disconfirming");
    expect(disconfirming).toBeDefined();
    expect(disconfirming!.candidate.plane).toBe("B");
    expect(disconfirming!.candidate).toBe(candidates.find((c) => c.id === "opp1"));
    // Support items keep their original planes too (A stays A, B stays B).
    const support = result.items.filter((i) => i.role === "support");
    expect(support.find((i) => i.candidate.id === "fp1")!.candidate.plane).toBe("A");
    expect(support.find((i) => i.candidate.id === "d1")!.candidate.plane).toBe("B");
  });

  it("reports no disconfirming fill when nothing derived survives into support", () => {
    const fp1 = cand({ id: "fp1", relevance: 0.9, content: "alpha bravo", derived: false, plane: "A" });
    const fp2 = cand({ id: "fp2", relevance: 0.8, content: "charlie delta", derived: false, plane: "A" });
    const result = diversifyEvidence({
      candidates: [fp1, fp2],
      k: 2,
      evidenceTokenBudget: 2000,
      derivedShare: 0.4,
      tokensOf: () => 10,
    });
    expect(result.stats.disconfirmingFilled).toBe(false);
    expect(result.items.every((i) => i.role === "support")).toBe(true);
  });
});
