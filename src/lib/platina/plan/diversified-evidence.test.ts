import { describe, expect, it } from "vitest";
import { selectDiversified, type BrainEvidenceRow, type FirstPartyEvidenceRow } from "./diversified-evidence";

const at = new Date("2026-10-01T00:00:00Z");

const brain = (id: string, over: Partial<BrainEvidenceRow> = {}): BrainEvidenceRow => ({
  id,
  content: `${id} distinct words ${id}-alpha ${id}-beta ${id}-gamma`,
  confidence: 0.7,
  createdAt: at,
  sourceSignalIds: [`sig-${id}`],
  absorbedChunkIds: [],
  generation: 0,
  status: "active",
  subjectKey: null,
  direction: null,
  gradeState: "untested",
  ...over,
});

const own = (id: string, content = `${id} own page words ${id}-one ${id}-two`): FirstPartyEvidenceRow => ({
  id,
  kind: "page",
  content,
  sourceUrl: `https://client.example/${id}`,
  createdAt: at,
});

describe("selectDiversified (W3b)", () => {
  it("returns the two planes as separate lists and never relabels them", () => {
    const sel = selectDiversified({
      brain: [brain("b1"), brain("b2")],
      refuted: [],
      firstParty: [own("a1"), own("a2")],
      derivedShare: 0.4,
      budgetOn: false,
    });
    expect(sel.pattern.map((r) => r.id).sort()).toEqual(["b1", "b2"]);
    expect(sel.baseline.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });

  it("a refuted chunk never becomes support, and fills the counter slot for the leading subject", () => {
    const sel = selectDiversified({
      brain: [brain("b1", { subjectKey: "topic:pfas", direction: "up" })],
      refuted: [brain("r1", { subjectKey: "topic:pfas", direction: "up", status: "demoted", gradeState: "refuted" })],
      firstParty: [own("a1")],
      derivedShare: 0.4,
      budgetOn: false,
    });
    expect(sel.pattern.map((r) => r.id)).toEqual(["b1"]);
    expect(sel.counter?.id).toBe("r1");
  });

  it("an opposite-direction live chunk on the same subject beats a refuted one for the counter slot", () => {
    const sel = selectDiversified({
      brain: [
        brain("b1", { subjectKey: "topic:pfas", direction: "up" }),
        brain("b2", { subjectKey: "topic:pfas", direction: "down" }),
      ],
      refuted: [brain("r1", { subjectKey: "topic:pfas", status: "demoted", gradeState: "refuted" })],
      firstParty: [],
      derivedShare: 1,
      budgetOn: false,
      k: 1,
    });
    expect(sel.pattern.map((r) => r.id)).toEqual(["b1"]);
    expect(sel.counter?.id).toBe("b2");
  });

  it("no counter item when nothing disputes the leading subject", () => {
    const sel = selectDiversified({
      brain: [brain("b1", { subjectKey: "topic:pfas", direction: "up" })],
      refuted: [brain("r1", { subjectKey: "topic:lcms", status: "demoted", gradeState: "refuted" })],
      firstParty: [],
      derivedShare: 0.4,
      budgetOn: false,
    });
    expect(sel.counter).toBeNull();
    expect(sel.stats.disconfirmingFilled).toBe(false);
  });

  it("caps derived (Brain) chunks against the evidence budget while first-party evidence stays", () => {
    const long = "x".repeat(400); // ~100 tokens as rendered
    const sel = selectDiversified({
      brain: Array.from({ length: 6 }, (_, i) => brain(`b${i}`, { content: `${long} b${i}` })),
      refuted: [],
      firstParty: [own("a1"), own("a2")],
      derivedShare: 0.4,
      budgetOn: false,
      k: 8,
      evidenceTokenBudget: 500, // derived cap = 200 tokens -> two Brain chunks at most
    });
    expect(sel.pattern.length).toBeLessThanOrEqual(2);
    expect(sel.baseline.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });

  it("with the budget on, drops whole items from the bottom and reports how many", () => {
    const long = (id: string) => `${"y".repeat(396)} ${id}`;
    const sel = selectDiversified({
      brain: [],
      refuted: [],
      firstParty: Array.from({ length: 6 }, (_, i) => own(`a${i}`, long(`a${i}`))),
      derivedShare: 0.4,
      budgetOn: true,
      k: 6,
      evidenceTokenBudget: 300, // ~100 tokens each -> three fit
    });
    expect(sel.baseline.length).toBe(3);
    expect(sel.stats.budgetDropped).toBe(3);
    for (const row of sel.baseline) expect(row.content.endsWith(row.id)).toBe(true); // whole items, never cut
  });

  it("an empty pool is not an error", () => {
    const sel = selectDiversified({ brain: [], refuted: [], firstParty: [], derivedShare: 0.4, budgetOn: true });
    expect(sel).toMatchObject({ baseline: [], pattern: [], counter: null });
  });
});
