import { describe, expect, it } from "vitest";
import { estimateCostUsd, estimateTokens, pricingFor } from "./pricing";

describe("estimateTokens", () => {
  it("~4 chars per token, ceil, empty is 0", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("pricingFor / estimateCostUsd", () => {
  it("prices known models", () => {
    // 1M in + 1M out on Groq llama
    expect(estimateCostUsd("llama-3.3-70b-versatile", 1_000_000, 1_000_000)).toBeCloseTo(
      1.38,
      5,
    );
    expect(estimateCostUsd("text-embedding-004", 1_000_000, 0)).toBeCloseTo(
      0.15,
      5,
    );
  });

  it("matches bedrock claude ids by family", () => {
    expect(pricingFor("anthropic.claude-opus-4-8").inPerM).toBe(15);
    expect(pricingFor("anthropic.claude-sonnet-5").outPerM).toBe(15);
  });

  it("unknown models get the conservative default, never zero", () => {
    const cost = estimateCostUsd("mystery-model", 1000, 1000);
    expect(cost).toBeGreaterThan(0);
  });

  it("never returns negative cost", () => {
    expect(estimateCostUsd("gemini-2.0-flash", -50, -50)).toBe(0);
  });
});
