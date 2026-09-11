import { describe, expect, it } from "vitest";
import { demotionsFromHistory, generateSyntheticHistory } from "./synthetic";

describe("synthetic Waters history", () => {
  it("covers eighteen months", () => {
    const history = generateSyntheticHistory();
    expect(history).toHaveLength(18);
    expect(history[0].month).toBe("2025-03");
    expect(history[17].month).toBe("2026-08");
  });

  it("produces conversion rates, not engagement volume", () => {
    for (const month of generateSyntheticHistory()) {
      expect(month.conversionRate).toBeGreaterThan(0);
      expect(month.qualifiedLeads).toBeLessThanOrEqual(month.leads);
    }
  });

  it("marks months that should demote a Brain hypothesis", () => {
    const history = generateSyntheticHistory();
    const demotions = demotionsFromHistory(history, "method-validation");
    expect(demotions.length).toBeGreaterThan(0);
    expect(demotions.every((d) => d.worked === false)).toBe(true);
  });
});
