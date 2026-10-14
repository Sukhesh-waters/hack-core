import { describe, expect, it } from "vitest";
import {
  filterByScope,
  freshnessLevel,
  freshnessMessage,
  levelWithVerdicts,
  refutedMessage,
  REPLAN_THRESHOLD,
  verdictLabel,
  type CitedVerdict,
} from "./freshness";

describe("B8 cited-evidence verdicts", () => {
  const refuted: CitedVerdict = {
    id: "c1",
    verdict: "refuted",
    at: new Date("2026-11-20T05:00:00Z"),
    metric: "topic_momentum",
    measuredValue: 0.8234,
    threshold: 1,
    direction: "below",
  };
  const held: CitedVerdict = { id: "c2", verdict: "promoted", at: null, metric: null, measuredValue: null, threshold: null, direction: null };

  it("a refuted cited chunk escalates to re-plan even with no new signals", () => {
    expect(levelWithVerdicts(0, [refuted])).toBe("replan");
    expect(levelWithVerdicts(1, [held])).toBe(freshnessLevel(1));
    expect(levelWithVerdicts(0, [])).toBe("current");
  });

  it("labels read as plain words with the measured number", () => {
    expect(verdictLabel(refuted)).toBe("Proved wrong on 2026-11-20: measured 0.82, below the 1 it was tested against");
    expect(verdictLabel(held)).toBe("Held up when tested");
    expect(verdictLabel({ ...refuted, measuredValue: null })).toBe("Proved wrong on 2026-11-20");
  });

  it("the banner counts what was proved wrong and never uses internal words", () => {
    expect(refutedMessage(1)).toContain("was proved wrong");
    expect(refutedMessage(3)).toContain("3 pieces of evidence");
    expect(`${refutedMessage(2)} ${verdictLabel(refuted)}`.toLowerCase()).not.toMatch(/falsifier|refut|grade/);
  });
});

describe("filterByScope", () => {
  const chunks = [
    { id: "a", sourceSignalIds: ["s1"] },
    { id: "b", sourceSignalIds: ["s2", "s9"] },
    { id: "c", sourceSignalIds: [] },
  ];

  it("returns everything when unscoped", () => {
    expect(filterByScope(chunks, null)).toHaveLength(3);
  });

  it("keeps only chunks that came from the client's own signals", () => {
    expect(filterByScope(chunks, new Set(["s9"])).map((c) => c.id)).toEqual(["b"]);
    expect(filterByScope(chunks, new Set(["nope"]))).toEqual([]);
  });

  it("drops a chunk with no provenance when scoped — it cannot be attributed", () => {
    expect(filterByScope(chunks, new Set(["s1", "s2"])).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("freshnessLevel / freshnessMessage", () => {
  it("maps counts to current, review and replan", () => {
    expect(freshnessLevel(0)).toBe("current");
    expect(freshnessLevel(1)).toBe("review");
    expect(freshnessLevel(REPLAN_THRESHOLD - 1)).toBe("review");
    expect(freshnessLevel(REPLAN_THRESHOLD)).toBe("replan");
  });

  it("says exactly what was counted, and for whom", () => {
    expect(freshnessMessage(0, "Northwind")).toContain("Up to date");
    expect(freshnessMessage(1, "Northwind")).toBe(
      "1 new validated signal for Northwind since this plan was written. Worth a look.",
    );
    expect(freshnessMessage(4, null)).toContain("in this workspace");
    expect(freshnessMessage(4, null)).toContain("Worth re-planning");
  });
});
