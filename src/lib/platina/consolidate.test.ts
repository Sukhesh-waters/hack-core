import { describe, expect, it } from "vitest";
import { buildDigest, planConsolidation, similarity, weightsOf, words, type BrainRow } from "./consolidate";
import type { TrustStat } from "./credit";

const now = new Date("2026-10-01T02:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
const row = (id: string, content: string, over: Partial<BrainRow> = {}): BrainRow => ({
  id,
  content,
  confidence: 0.7,
  status: "active",
  absorbedChunkIds: [],
  lastRetrievedAt: null,
  createdAt: day(10),
  ...over,
});

describe("planConsolidation (C8.5)", () => {
  const brain = [
    row("a", "Agilent is pushing GC-MS workflows for PFAS testing in Gulf water laboratories", { confidence: 0.8 }),
    row("b", "Agilent pushing GC-MS workflows for PFAS testing in Gulf water laboratories now"),
    row("c", "Shimadzu sponsors ARABLAB LIVE with a liquid chromatography showcase"),
    row("old", "An insight nobody used", { createdAt: day(200) }),
    row("gone", "Already superseded duplicate of Agilent GC-MS PFAS testing Gulf water laboratories", { status: "superseded" }),
  ];

  it("merges near-duplicates into the strongest, never touching non-active rows", () => {
    const plan = planConsolidation({ brain, trust: [], now });
    expect(plan.merges).toEqual([expect.objectContaining({ keepId: "a", absorbIds: ["b"] })]);
    expect(similarity(words(brain[0].content), words(brain[2].content))).toBeLessThan(0.2);
  });

  it("retires only with trust evidence: old and unused alone is not enough", () => {
    expect(planConsolidation({ brain, trust: [], now }).retire).toEqual([]);
    const low: TrustStat = { ref: "brain:old", label: "x", plane: "C", alpha: 1, beta: 4, n: 5, mean: 0.2, status: "ok" };
    const plan = planConsolidation({ brain, trust: [low], now });
    expect(plan.retire.map((r) => r.id)).toEqual(["old"]);
    expect(plan.retire[0].why).toContain("trust 20% over 5 decisions");
  });

  it("is idempotent: after the merge is applied there is nothing left to merge", () => {
    const after = brain.map((b) => (b.id === "b" ? { ...b, status: "superseded" } : b.id === "a" ? { ...b, absorbedChunkIds: ["b"] } : b));
    expect(planConsolidation({ brain: after, trust: [], now }).merges).toEqual([]);
  });
});

describe("buildDigest", () => {
  it("reports weight moves against last month, merges and the half-life in plain sentences", () => {
    const learned = {
      credits: [],
      trust: [],
      features: [{ feature: "topic", value: "pfas analysis", alpha: 5, beta: 2, n: 6, mean: 0.714, status: "ok" as const }],
    };
    const weights = weightsOf(learned, []);
    const d = buildDigest({
      month: "2026-10",
      weights,
      previous: { features: { "topic:pfas analysis": 0.5 }, publicLane: {}, trust: {} },
      learned,
      titles: new Map(),
      plan: { merges: [{ keepId: "a", keep: "", absorbIds: ["b", "c"], absorbed: [], priorAbsorbed: [], similarity: 0.7 }], retire: [] },
      halfLifeDays: 90,
    });
    expect(d.gained).toEqual([{ what: "suggestions with pfas analysis", from: 0.5, to: 0.714 }]);
    expect(d.lines[0]).toBe("Gained weight: suggestions with pfas analysis (50% → 71%).");
    expect(d.lines[3]).toBe("Brain: 2 repeated insights folded into the 1 they repeat (kept, not deleted); 0 retired.");
    expect(d.lines[4]).toContain("90-day half-life");
  });
});
