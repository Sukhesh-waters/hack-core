import { describe, expect, it } from "vitest";
import {
  DERIVED_SHARE,
  EVIDENCE_TOKEN_BUDGET,
  PLANNER_BUDGET,
  estimateTokens,
  fitSections,
  type BudgetItem,
} from "./context-budget";

describe("estimateTokens", () => {
  it("matches the chars/4 estimate used by src/lib/ai/pricing.ts (same formula; not importable across the Platina boundary)", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("a".repeat(401))).toBe(101); // ceil, not floor
    expect(estimateTokens("")).toBe(0);
  });
});

describe("PLANNER_BUDGET", () => {
  it("matches the plan §5 B7 table", () => {
    expect(PLANNER_BUDGET.clientStandard).toEqual({ cap: 400, alwaysInclude: true });
    expect(PLANNER_BUDGET.evidence.cap).toBe(2400);
    expect(PLANNER_BUDGET.evidence.alwaysInclude).toBe(false);
    expect(PLANNER_BUDGET.derivedHypotheses.cap).toBe(960); // 40% of 2400
    expect(PLANNER_BUDGET.disconfirming.maxItems).toBe(1);
    expect(PLANNER_BUDGET.lessonsPatterns).toEqual({ cap: 500, alwaysInclude: true });
    expect(PLANNER_BUDGET.instructions.cap).toBe(Infinity);
    expect(PLANNER_BUDGET.instructions.alwaysInclude).toBe(true);
    expect(EVIDENCE_TOKEN_BUDGET).toBe(2400);
    expect(DERIVED_SHARE).toBe(0.4);
  });
});

describe("fitSections", () => {
  // estimateTokens is chars/4, so these lengths give exact token counts.
  const item = (id: string, tokens: number): BudgetItem => ({ id, text: "x".repeat(tokens * 4) });

  it("keeps whole items from the top until the cap, never truncating mid-item, and drops the bottom", () => {
    const a = item("a", 100);
    const b = item("b", 150);
    const c = item("c", 200);
    const result = fitSections({ evidence: [a, b, c] }, { evidence: { cap: 200, alwaysInclude: false } });
    const section = result.sections.evidence;
    expect(section.kept.map((i) => i.id)).toEqual(["a"]);
    expect(section.dropped).toEqual([
      { id: "b", tokens: 150 },
      { id: "c", tokens: 200 },
    ]);
    expect(section.totalTokens).toBe(100);
    expect(section.over).toBe(false);
    // Every kept item's text survives whole, byte for byte.
    expect(section.kept[0].text).toBe(a.text);
  });

  it("the exact boundary (cumulative === cap) keeps the item, not drops it", () => {
    const a = item("a", 100);
    const b = item("b", 150);
    const c = item("c", 200);
    // a+b = 250 === cap; both kept. c pushes over, dropped.
    const result = fitSections({ evidence: [a, b, c] }, { evidence: { cap: 250, alwaysInclude: false } });
    const section = result.sections.evidence;
    expect(section.kept.map((i) => i.id)).toEqual(["a", "b"]);
    expect(section.dropped.map((d) => d.id)).toEqual(["c"]);
    expect(section.totalTokens).toBe(250);
  });

  it("an always-included section is kept whole even over its cap, and reported as over", () => {
    const big = item("big", 100);
    const result = fitSections(
      { clientStandard: [big] },
      { clientStandard: { cap: 50, alwaysInclude: true } },
    );
    const section = result.sections.clientStandard;
    expect(section.kept.map((i) => i.id)).toEqual(["big"]);
    expect(section.dropped).toEqual([]);
    expect(section.totalTokens).toBe(100);
    expect(section.over).toBe(true);
  });

  it("an always-included section within its cap is not reported as over", () => {
    const small = item("small", 10);
    const result = fitSections(
      { lessonsPatterns: [small] },
      { lessonsPatterns: { cap: 500, alwaysInclude: true } },
    );
    expect(result.sections.lessonsPatterns.over).toBe(false);
  });

  it("enforces a maxItems cap (the disconfirming slot: 1 chunk)", () => {
    const a = item("a", 10);
    const b = item("b", 10);
    const result = fitSections(
      { disconfirming: [a, b] },
      { disconfirming: { cap: Infinity, maxItems: 1, alwaysInclude: false } },
    );
    const section = result.sections.disconfirming;
    expect(section.kept.map((i) => i.id)).toEqual(["a"]);
    expect(section.dropped.map((d) => d.id)).toEqual(["b"]);
  });

  it("reports a total across all sections", () => {
    const a = item("a", 100);
    const b = item("b", 50);
    const result = fitSections(
      { clientStandard: [a], lessonsPatterns: [b] },
      { clientStandard: { cap: 400, alwaysInclude: true }, lessonsPatterns: { cap: 500, alwaysInclude: true } },
    );
    expect(result.totalTokens).toBe(150);
  });

  it("treats a section key missing from the budget as uncapped", () => {
    const a = item("a", 100);
    const result = fitSections({ extra: [a] }, {});
    expect(result.sections.extra.kept.map((i) => i.id)).toEqual(["a"]);
    expect(result.sections.extra.over).toBe(false);
  });

  it("an empty section produces zero tokens and is not over", () => {
    const result = fitSections({ evidence: [] }, { evidence: { cap: 2400, alwaysInclude: false } });
    expect(result.sections.evidence).toEqual({ kept: [], dropped: [], totalTokens: 0, over: false });
  });
});
