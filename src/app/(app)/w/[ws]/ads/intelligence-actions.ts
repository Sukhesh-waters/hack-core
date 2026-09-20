"use server";

import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  topAdEligibleContent,
  recentCompetitorAds,
} from "@/db/queries/ad-intelligence";
import {
  evaluateContentForAds,
  type AdSuitabilityResult,
  type MarketTrendContext,
  analyzeCompetitorAds,
  type PatternAdInput,
} from "@/lib/ai/agents/critic";
import {
  analyzeCampaignPerformance,
  type CampaignStrategy,
  type CampaignPostMortem,
  type CampaignContext,
  type MarketIntelligence,
} from "@/lib/ai/agents/strategy";
import { runCampaignStrategy } from "@/lib/orchestrator/campaign-strategy";
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

    // 3. If we have competitor ad data, run the ads-insight critic agent first
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
  /** Independent Critic findings; empty when the strategy passed review. */
  criticFeedback?: string[];
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

    const result = await runCampaignStrategy({
      workspaceId,
      clientId,
      selectedContentId,
    });

    switch (result.status) {
      case "completed":
        return {
          strategy: result.output.strategy,
          criticFeedback: result.output.criticFeedback,
        };
      case "invalid_proposal":
        return {
          error: `The AI proposed an unusable strategy (${result.reason}) — try again.`,
        };
      case "insufficient_context":
        return { error: "Not enough context to build a strategy yet." };
    }
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
