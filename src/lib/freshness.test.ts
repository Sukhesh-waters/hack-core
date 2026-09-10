import { describe, expect, it } from "vitest";
import { compactSimilarChunks, getFreshness, STALE_AFTER_DAYS } from "./freshness";

const NOW = new Date("2026-07-04T00:00:00Z");

describe("freshness heartbeat", () => {
  it("never-pulled accounts report 'never'", () => {
    expect(getFreshness(null, NOW)).toEqual({ status: "never" });
  });

  it("recent pulls are fresh", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000);
    expect(getFreshness(twoDaysAgo, NOW)).toEqual({
      status: "fresh",
      ageDays: 2,
    });
  });

  it(`pulls older than ${STALE_AFTER_DAYS} days are flagged stale, not hidden`, () => {
    const nineDaysAgo = new Date(NOW.getTime() - 9 * 86_400_000);
    expect(getFreshness(nineDaysAgo, NOW)).toEqual({
      status: "stale",
      ageDays: 9,
    });
  });
});

describe("compactSimilarChunks", () => {
  it("deduplicates near-identical text chunks", () => {
    const chunks = [
      "Our core brand pillar focuses on sustainable coffee roasting and ethical sourcing.",
      "Our core brand pillar focuses on sustainable coffee roasting and ethical sourcing.",
      "Unique second chunk about seasonal menu updates.",
    ];
    const compacted = compactSimilarChunks(chunks);
    expect(compacted).toHaveLength(2);
    expect(compacted[0]).toContain("sustainable coffee roasting");
    expect(compacted[1]).toContain("seasonal menu updates");
  });
});
