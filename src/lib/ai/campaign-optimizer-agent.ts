import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignContext = {
  name: string;
  objective: string;
  budget: number;
  audience: { demographics?: string; interests?: string[]; locations?: string[] };
  creativeSummary: string;
  /** Performance metrics (0 = no data yet). */
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type MarketIntelligence = {
  competitorHooks: string[];
  trendingFormats: string[];
  audienceInsights: string[];
};

export type BrandContext = {
  brandName: string;
  positioning: string;
  pillar?: string;
};

// ---------------------------------------------------------------------------
// Pre-launch strategy
// ---------------------------------------------------------------------------

const strategySchema = z.object({
  recommendedObjective: z.enum([
    "awareness",
    "traffic",
    "engagement",
    "leads",
    "conversions",
  ]),
  recommendedBudgetRange: z.object({
    min: z.number().min(0),
    max: z.number().min(0),
  }),
  audienceSuggestion: z.string().min(5),
  adCopyVariants: z.array(z.string().min(5)).min(1).max(3),
  strategySummary: z.string().min(10),
  keyRisks: z.array(z.string()),
});

export type CampaignStrategy = z.infer<typeof strategySchema>;

export function buildStrategyPrompt(
  brand: BrandContext,
  market: MarketIntelligence,
  selectedContent?: { title: string; body: string | null },
): string {
  return [
    `Brand: "${brand.brandName}" — Positioning: "${brand.positioning}"`,
    selectedContent
      ? `Selected Content: "${selectedContent.title}" — ${selectedContent.body?.slice(0, 200) ?? "(no body)"}`
      : "",
    "",
    "MARKET INTELLIGENCE:",
    `• Competitor hooks: ${market.competitorHooks.slice(0, 5).join("; ") || "none observed"}`,
    `• Trending formats: ${market.trendingFormats.slice(0, 5).join("; ") || "unknown"}`,
    `• Audience insights: ${market.audienceInsights.slice(0, 3).join("; ") || "general"}`,
    "",
    "Generate a campaign launch strategy including:",
    "1. Recommended objective (awareness/traffic/engagement/leads/conversions)",
    "2. Budget range (min/max in dollars)",
    "3. Audience targeting suggestion",
    "4. 1-3 ad copy variants",
    "5. Strategy summary",
    "6. Key risks to watch",
    "",
    'Reply with JSON only matching schema: {"recommendedObjective":string, "recommendedBudgetRange":{"min":number,"max":number}, "audienceSuggestion":string, "adCopyVariants":string[], "strategySummary":string, "keyRisks":string[]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Pre-launch mode: generates a complete campaign strategy from market
 * intelligence + brand context + optional selected content.
 */
export async function generateCampaignStrategy(
  brand: BrandContext,
  market: MarketIntelligence,
  selectedContent?: { title: string; body: string | null },
): Promise<CampaignStrategy> {
  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are a paid media strategist. Create data-informed campaign strategies based on competitive intelligence and brand positioning. Be specific with audience targeting and budget recommendations. Never fabricate performance predictions.",
    prompt: buildStrategyPrompt(brand, market, selectedContent),
  });

  return strategySchema.parse(JSON.parse(raw));
}

// ---------------------------------------------------------------------------
// Post-mortem analysis
// ---------------------------------------------------------------------------

const postMortemSchema = z.object({
  whatWorked: z.array(z.string().min(5)),
  whatFailed: z.array(z.string().min(5)),
  levelUpActions: z.array(z.string().min(5)),
  nextIterationBrief: z.string().min(10),
});

export type CampaignPostMortem = z.infer<typeof postMortemSchema>;

export function buildPostMortemPrompt(
  campaign: CampaignContext,
  market: MarketIntelligence,
): string {
  const hasPerformance = campaign.spend > 0 || campaign.impressions > 0;

  const perfBlock = hasPerformance
    ? [
        "PERFORMANCE DATA:",
        `• Spend: $${campaign.spend.toFixed(2)}`,
        `• Impressions: ${campaign.impressions.toLocaleString()}`,
        `• Clicks: ${campaign.clicks.toLocaleString()} (CTR: ${campaign.impressions > 0 ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2) : "0"}%)`,
        `• Conversions: ${campaign.conversions}`,
        `• CPC: $${campaign.clicks > 0 ? (campaign.spend / campaign.clicks).toFixed(2) : "N/A"}`,
        `• CPM: $${campaign.impressions > 0 ? ((campaign.spend / campaign.impressions) * 1000).toFixed(2) : "N/A"}`,
      ]
    : [
        "PERFORMANCE DATA: Not yet available (pre-launch or no tracking connected).",
        "Analyze based on strategy strength and market alignment only.",
      ];

  return [
    `Campaign: "${campaign.name}"`,
    `Objective: ${campaign.objective}`,
    `Budget: $${campaign.budget}`,
    `Creative: ${campaign.creativeSummary}`,
    `Audience: ${campaign.audience.demographics ?? "general"}; interests: ${(campaign.audience.interests ?? []).join(", ") || "none"}`,
    "",
    ...perfBlock,
    "",
    "CURRENT MARKET TRENDS:",
    `• Competitor hooks: ${market.competitorHooks.slice(0, 5).join("; ") || "none observed"}`,
    `• Trending formats: ${market.trendingFormats.slice(0, 5).join("; ") || "unknown"}`,
    "",
    "Provide honest post-mortem analysis:",
    "1. What worked (specific elements)",
    "2. What failed or underperformed (specific elements)",
    "3. Level-up actions for the next iteration",
    "4. A brief for the next campaign iteration",
    "",
    'Reply with JSON only matching schema: {"whatWorked":string[], "whatFailed":string[], "levelUpActions":string[], "nextIterationBrief":string}',
  ].join("\n");
}

/**
 * Post-mortem mode: analyzes campaign performance (or strategy if no
 * performance data yet) and generates improvement recommendations.
 *
 * Graceful degradation: when spend/impressions/clicks are 0, the agent
 * operates in "strategy review" mode — evaluating the campaign brief
 * against market intelligence without fabricating performance predictions.
 */
export async function analyzeCampaignPerformance(
  campaign: CampaignContext,
  market: MarketIntelligence,
): Promise<CampaignPostMortem> {
  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are a performance marketing analyst reviewing campaign results. Be brutally honest about what worked and what didn't. When performance data is unavailable, analyze the strategy and creative against market intelligence. Never fabricate metrics.",
    prompt: buildPostMortemPrompt(campaign, market),
  });

  return postMortemSchema.parse(JSON.parse(raw));
}
