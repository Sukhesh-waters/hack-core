/**
 * Rough per-model pricing (USD per 1M tokens). Honest telemetry for the
 * cockpit + daily cap — not accounting. Unknown models fall back to a
 * conservative default so spend is over- rather than under-counted.
 */

export type ModelPricing = { inPerM: number; outPerM: number };

const PRICING: Array<{ match: (model: string) => boolean } & ModelPricing> = [
  { match: (m) => m.startsWith("llama-3.3-70b"), inPerM: 0.59, outPerM: 0.79 },
  { match: (m) => m === "gemini-2.0-flash", inPerM: 0.1, outPerM: 0.4 },
  { match: (m) => m.startsWith("gemini-2.5-pro"), inPerM: 1.25, outPerM: 10 },
  { match: (m) => m === "text-embedding-004", inPerM: 0.15, outPerM: 0 },
  { match: (m) => m === "gemini-embedding-001", inPerM: 0.15, outPerM: 0 },
  {
    match: (m) => m.includes("claude") && m.includes("opus"),
    inPerM: 15,
    outPerM: 75,
  },
  {
    match: (m) => m.includes("claude") && m.includes("sonnet"),
    inPerM: 3,
    outPerM: 15,
  },
];

const DEFAULT_PRICING: ModelPricing = { inPerM: 3, outPerM: 15 };

export function pricingFor(model: string): ModelPricing {
  return PRICING.find((p) => p.match(model)) ?? DEFAULT_PRICING;
}

/** ~4 chars per token — the fallback when a provider returns no usage. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const price = pricingFor(model);
  return (
    (Math.max(0, tokensIn) * price.inPerM +
      Math.max(0, tokensOut) * price.outPerM) /
    1_000_000
  );
}
