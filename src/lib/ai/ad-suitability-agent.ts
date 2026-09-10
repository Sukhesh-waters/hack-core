import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrganicContentItem = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  pillar: string | null;
  /** Engagement rate from first-party baseline (if scored). */
  engagementRate?: number;
};

export type MarketTrendContext = {
  hooksObserved: string[];
  formatBreakdown: string[];
  topAudiences: string[];
};

export type AdSuitabilityResult = {
  contentId: string;
  suitabilityScore: number;
  hookStrength: number;
  commercialIntent: number;
  ctaQuality: number;
  audienceAlignment: number;
  reasoning: string;
  suggestedAdCopy: string;
  suggestedObjective: string;
};

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const suitabilityItemSchema = z.object({
  contentId: z.string(),
  suitabilityScore: z.number().min(0).max(100),
  hookStrength: z.number().min(0).max(100),
  commercialIntent: z.number().min(0).max(100),
  ctaQuality: z.number().min(0).max(100),
  audienceAlignment: z.number().min(0).max(100),
  reasoning: z.string().min(5),
  suggestedAdCopy: z.string().min(5),
  suggestedObjective: z.enum([
    "awareness",
    "traffic",
    "engagement",
    "leads",
    "conversions",
  ]),
});

const suitabilityResponseSchema = z.object({
  rankings: z.array(suitabilityItemSchema),
});

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildAdSuitabilityPrompt(
  content: OrganicContentItem[],
  marketContext: MarketTrendContext,
): string {
  const contentLines = content.map(
    (c) =>
      `[Content ID: ${c.id}] title: "${c.title}"; type: ${c.type}; pillar: ${c.pillar ?? "general"}; body: ${c.body?.slice(0, 300) ?? "(no body)"}${c.engagementRate !== undefined ? `; engagement: ${(c.engagementRate * 100).toFixed(1)}%` : ""}`,
  );

  const trendLines = [
    `Hooks winning in market: ${marketContext.hooksObserved.slice(0, 5).join("; ") || "unknown"}`,
    `Formats trending: ${marketContext.formatBreakdown.slice(0, 5).join("; ") || "unknown"}`,
    `Top audiences: ${marketContext.topAudiences.slice(0, 3).join("; ") || "general"}`,
  ];

  return [
    "Evaluate the following organic content items for paid ad suitability.",
    "",
    "ORGANIC CONTENT:",
    ...contentLines,
    "",
    "CURRENT MARKET TRENDS (from competitor ad intelligence):",
    ...trendLines,
    "",
    "For each content item, score 0-100 on: hookStrength, commercialIntent, ctaQuality, audienceAlignment.",
    "Compute suitabilityScore as the weighted average (hook 30%, commercial 25%, cta 25%, audience 20%).",
    "For each, provide reasoning (why this content works or doesn't as an ad), suggestedAdCopy (a short ad copy adaptation), and suggestedObjective (awareness/traffic/engagement/leads/conversions).",
    "Rank by suitabilityScore descending. Return top items only (max 5).",
    "",
    'Reply with JSON only matching schema: {"rankings":[{"contentId":string, "suitabilityScore":number, "hookStrength":number, "commercialIntent":number, "ctaQuality":number, "audienceAlignment":number, "reasoning":string, "suggestedAdCopy":string, "suggestedObjective":"awareness"|"traffic"|"engagement"|"leads"|"conversions"}]}',
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * Ad Suitability Agent.
 * Evaluates organic content drafts against market trends to determine which
 * posts are best suited for paid promotion.
 *
 * Isolation Guarantee:
 * - Reads first-party content metadata (Tier 1) and aggregated market trend
 *   observations (derived from Tier 2 pattern_ads via ads-insight-agent).
 * - Never assigns scores to pattern data.
 * - Never writes to posts/baseline tables.
 * - Output is a recommendation, not a mutation.
 */
export async function evaluateContentForAds(
  content: OrganicContentItem[],
  marketContext: MarketTrendContext,
): Promise<AdSuitabilityResult[]> {
  if (content.length === 0) return [];

  // Provide sensible defaults for empty market context
  const ctx: MarketTrendContext = {
    hooksObserved:
      marketContext.hooksObserved.length > 0
        ? marketContext.hooksObserved
        : ["problem-solution", "before-after", "listicle"],
    formatBreakdown:
      marketContext.formatBreakdown.length > 0
        ? marketContext.formatBreakdown
        : ["single image", "carousel", "short video"],
    topAudiences:
      marketContext.topAudiences.length > 0
        ? marketContext.topAudiences
        : ["general"],
  };

  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are a paid media strategist evaluating organic social content for ad suitability. Score honestly — not every post makes a good ad. Prefer content with clear hooks, commercial intent, and audience alignment with current market trends.",
    prompt: buildAdSuitabilityPrompt(content, ctx),
  });

  const parsed = suitabilityResponseSchema.parse(JSON.parse(raw));

  // Filter to valid content IDs only (prevent hallucinated IDs)
  const validIds = new Set(content.map((c) => c.id));
  return parsed.rankings
    .filter((r) => validIds.has(r.contentId))
    .sort((a, b) => b.suitabilityScore - a.suitabilityScore);
}
