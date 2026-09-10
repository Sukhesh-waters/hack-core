"use server";

import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  topAdEligibleContent,
  recentCompetitorAds,
  clientBrandContext,
} from "@/db/queries/ad-intelligence";
import {
  evaluateContentForAds,
  type AdSuitabilityResult,
  type MarketTrendContext,
} from "@/lib/ai/ad-suitability-agent";
import {
  analyzeCompetitorAds,
  type PatternAdInput,
} from "@/lib/ai/ads-insight-agent";
import {
  generateCampaignStrategy,
  analyzeCampaignPerformance,
  type CampaignStrategy,
  type CampaignPostMortem,
  type CampaignContext,
  type MarketIntelligence,
} from "@/lib/ai/campaign-optimizer-agent";
import { actionErrorMessage } from "@/lib/action-errors";

// ---------------------------------------------------------------------------
// Action: Analyze organic content for ad suitability
// ---------------------------------------------------------------------------

export type AdSuitabilityState = {
  rankings?: AdSuitabilityResult[];
  error?: string;
};

export async function analyzeContentForAdsAction(
  workspaceId: string,
  clientId: string,
): Promise<AdSuitabilityState> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    // 1. Fetch organic content candidates
    const contentItems = await topAdEligibleContent(workspaceId, clientId);
    if (contentItems.length === 0) {
      return { rankings: [], error: undefined };
    }

    // 2. Fetch scraped competitor ads for market context
    const competitorAds = await recentCompetitorAds(workspaceId);
    let marketContext: MarketTrendContext = {
      hooksObserved: [],
      formatBreakdown: [],
      topAudiences: [],
    };

    // 3. If we have competitor ad data, run the ads-insight-agent first
    if (competitorAds.length > 0) {
      const adInputs: PatternAdInput[] = competitorAds.map((ad) => ({
        id: ad.id,
        pageHandle: ad.pageHandle,
        adBody: ad.adBody,
        adFormat: ad.adFormat,
        targetAudience: ad.targetAudience,
        postedAtIso: ad.postedAt.toISOString(),
      }));

      const insight = await analyzeCompetitorAds(adInputs);
      marketContext = {
        hooksObserved: insight.hooksObserved,
        formatBreakdown: insight.formatBreakdown,
        topAudiences: competitorAds
          .map((a) => a.targetAudience)
          .filter((a): a is string => a !== null)
          .slice(0, 5),
      };
    }

    // 4. Run the ad-suitability agent
    const rankings = await evaluateContentForAds(
      contentItems.map((c) => ({
        id: c.id,
        title: c.title,
        body: c.body,
        type: c.type,
        pillar: c.pillar,
      })),
      marketContext,
    );

    return { rankings };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Action: Generate AI campaign strategy
// ---------------------------------------------------------------------------

export type CampaignStrategyState = {
  strategy?: CampaignStrategy;
  error?: string;
};

export async function generateCampaignStrategyAction(
  workspaceId: string,
  clientId: string,
  selectedContentId?: string,
): Promise<CampaignStrategyState> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    // 1. Build brand context
    const clientInfo = await clientBrandContext(workspaceId, clientId);
    const brandCtx = {
      brandName: clientInfo?.name ?? "Brand",
      positioning: clientInfo?.handle
        ? `@${clientInfo.handle}`
        : "Social media brand",
    };

    // 2. Build market intelligence
    const competitorAds = await recentCompetitorAds(workspaceId);
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

    // 3. Optionally include selected content
    let selectedContent: { title: string; body: string | null } | undefined;
    if (selectedContentId) {
      const allContent = await topAdEligibleContent(workspaceId, clientId, 50);
      const found = allContent.find((c) => c.id === selectedContentId);
      if (found) {
        selectedContent = { title: found.title, body: found.body };
      }
    }

    // 4. Generate strategy
    const strategy = await generateCampaignStrategy(
      brandCtx,
      market,
      selectedContent,
    );

    return { strategy };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Action: Analyze campaign performance (post-mortem)
// ---------------------------------------------------------------------------

export type CampaignPostMortemState = {
  analysis?: CampaignPostMortem;
  error?: string;
};

export async function analyzeCampaignPerformanceAction(
  workspaceId: string,
  campaign: CampaignContext,
): Promise<CampaignPostMortemState> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const competitorAds = await recentCompetitorAds(workspaceId);
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

    const analysis = await analyzeCampaignPerformance(campaign, market);
    return { analysis };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
