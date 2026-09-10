import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

export type PatternAdInput = {
  id: string;
  pageHandle: string;
  adBody: string | null;
  adFormat: string | null;
  targetAudience: string | null;
  postedAtIso: string;
};

const adsInsightSchema = z.object({
  summary: z.string().min(5),
  hooksObserved: z.array(z.string()),
  formatBreakdown: z.array(z.string()),
  citations: z.array(z.string()),
});

export type AdsInsightResult = z.infer<typeof adsInsightSchema>;

export function buildAdsInsightPrompt(ads: PatternAdInput[]): string {
  const adLines = ads.map(
    (a) =>
      `[Ad ID: ${a.id}] handle: ${a.pageHandle}; format: ${a.adFormat ?? "unknown"}; audience: ${a.targetAudience ?? "general"}; body: ${a.adBody ?? "(no copy)"}`,
  );

  return [
    "Analyze the following competitor ads from the public pattern layer:",
    ...adLines,
    "",
    "Provide a strategic synthesis of hooks, visual formats, and audience positioning.",
    "Rule: Every insight MUST cite pattern ad IDs from the input list above.",
    'Reply with JSON only matching schema: {"summary":string, "hooksObserved":string[], "formatBreakdown":string[], "citations":string[]}',
  ].join("\n");
}

/**
 * F3 · Ads Insight Agent.
 * Analyzes competitor ads in the pattern layer. Cites pattern_ads IDs only;
 * outputs evidence-backed observations that can seed inspiration topics.
 */
export async function analyzeCompetitorAds(
  ads: PatternAdInput[],
): Promise<AdsInsightResult> {
  if (ads.length === 0) {
    return {
      summary: "No competitor ads available for analysis.",
      hooksObserved: [],
      formatBreakdown: [],
      citations: [],
    };
  }

  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are an ad intelligence analyst synthesizing competitor creative strategies. Never fabricate performance data or baseline metrics.",
    prompt: buildAdsInsightPrompt(ads),
  });

  const parsed = adsInsightSchema.parse(JSON.parse(raw));
  // Filter citations to valid input IDs
  const validIds = new Set(ads.map((a) => a.id));
  return {
    ...parsed,
    citations: parsed.citations.filter((id) => validIds.has(id)),
  };
}
