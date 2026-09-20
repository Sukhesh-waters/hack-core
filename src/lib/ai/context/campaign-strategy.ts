import {
  clientBrandContext,
  recentCompetitorAds,
  topAdEligibleContent,
} from "@/db/queries/ad-intelligence";
import type { BrandContext, MarketIntelligence } from "@/lib/ai/agents/strategy";
import { logContextAssembly, type ContextResult } from "@/lib/ai/context/types";

export type CampaignStrategyContextParams = {
  workspaceId: string;
  clientId: string;
  selectedContentId?: string;
};

export type CampaignStrategyContext = {
  brand: BrandContext;
  market: MarketIntelligence;
  selectedContent?: { title: string; body: string | null };
};

/**
 * Context recipe for task_type "campaign_strategy". Pattern-layer task:
 * public competitor-ad intelligence plus declared brand identity. It
 * deliberately excludes first-party baseline/performance rows — mixing them
 * into this prompt would violate the two-layer rule, so no min-N gate applies
 * (the gate guards first-party direction/magnitude scores, which this task
 * never shows). If campaign strategy ever needs first-party evidence, that is
 * an explicit layer-mixing decision, not something to add here quietly.
 * SQL only — there is no free-text topic to embed for a vector query.
 */
export async function assembleCampaignStrategyContext(
  params: CampaignStrategyContextParams,
): Promise<ContextResult<CampaignStrategyContext>> {
  const { workspaceId, clientId, selectedContentId } = params;

  const [clientInfo, competitorAds] = await Promise.all([
    clientBrandContext(workspaceId, clientId),
    recentCompetitorAds(workspaceId),
  ]);

  const brand: BrandContext = {
    brandName: clientInfo?.name ?? "Brand",
    positioning: clientInfo?.handle
      ? `@${clientInfo.handle}`
      : "Social media brand",
  };

  const market: MarketIntelligence = {
    competitorHooks: competitorAds
      .map((a) => a.adBody)
      .filter((b): b is string => b !== null)
      .slice(0, 5),
    trendingFormats: competitorAds
      .map((a) => a.adFormat)
      .filter((f): f is string => f !== null)
      .slice(0, 5),
    audienceInsights: competitorAds
      .map((a) => a.targetAudience)
      .filter((a): a is string => a !== null)
      .slice(0, 3),
  };

  let selectedContent: CampaignStrategyContext["selectedContent"];
  if (selectedContentId) {
    const allContent = await topAdEligibleContent(workspaceId, clientId, 50);
    const found = allContent.find((c) => c.id === selectedContentId);
    if (found) selectedContent = { title: found.title, body: found.body };
  }

  logContextAssembly({
    taskType: "campaign_strategy",
    workspaceId,
    state: "context_available",
    sections: {
      competitorHooks: market.competitorHooks.length,
      trendingFormats: market.trendingFormats.length,
      audienceInsights: market.audienceInsights.length,
      hasSelectedContent: selectedContent ? 1 : 0,
    },
  });

  return {
    state: "context_available",
    context: { brand, market, selectedContent },
  };
}
