import { describe, expect, it } from "vitest";
import {
  filterByScope,
  freshnessLevel,
  freshnessMessage,
  REPLAN_THRESHOLD,
} from "./freshness";

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
