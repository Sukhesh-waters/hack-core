import { describe, expect, it } from "vitest";
import { conversionRate, scoreLeadQuality } from "./scoring";

describe("lead-quality scoring", () => {
  it("refuses a number below min-N", () => {
    const result = scoreLeadQuality(0.2, [
      { conversionRate: 0.1, recordedAt: new Date() },
    ]);
    expect(result.status).toBe("insufficient_baseline");
  });

  it("scores conversion rate, not volume", () => {
    const baseline = Array.from({ length: 20 }, (_, i) => ({
      conversionRate: 0.1 + (i % 3) * 0.01,
      recordedAt: new Date(),
    }));
    const result = scoreLeadQuality(0.4, baseline);
    expect(result.status).toBe("scored");
    if (result.status === "scored") {
      expect(result.direction).toBe("up");
      expect(result.qualityScore).toBeGreaterThan(0);
    }
  });

  it("computes conversion from qualified / leads", () => {
    expect(conversionRate(100, 25)).toBe(0.25);
    expect(conversionRate(0, 10)).toBeNull();
  });

  it("does not export a field named magnitude", async () => {
    const mod = await import("./scoring");
    expect("magnitude" in mod).toBe(false);
  });
});
