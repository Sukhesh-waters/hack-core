import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buildStrategyPrompt,
  buildPostMortemPrompt,
  generateCampaignStrategy,
  analyzeCampaignPerformance,
  type MarketIntelligence,
  type BrandContext,
  type CampaignContext,
} from "./strategy";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

beforeEach(() => routeAIMock.mockReset());

const brand: BrandContext = {
  brandName: "FreshRoast Coffee",
  positioning: "Specialty coffee with printed roast dates — freshness you can verify",
};

const market: MarketIntelligence = {
  competitorHooks: ["Stop buying stale coffee", "Organic isn't enough"],
  trendingFormats: ["UGC short video", "carousel before-after"],
  audienceInsights: ["Coffee enthusiasts 25-45", "Health-conscious millennials"],
};

describe("campaign strategy (strategy agent)", () => {
  it("builds strategy prompt with brand and market context", () => {
    const prompt = buildStrategyPrompt(brand, market);
    expect(prompt).toContain("FreshRoast Coffee");
    expect(prompt).toContain("Stop buying stale coffee");
    expect(prompt).toContain("UGC short video");
  });

  it("includes selected content when provided", () => {
    const prompt = buildStrategyPrompt(brand, market, {
      title: "Why Roast Dates Matter",
      body: "Most coffee you buy was roasted months ago.",
    });
    expect(prompt).toContain("Why Roast Dates Matter");
    expect(prompt).toContain("roasted months ago");
  });

  it("generates and parses campaign strategy", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        recommendedObjective: "traffic",
        recommendedBudgetRange: { min: 200, max: 500 },
        audienceSuggestion:
          "Coffee enthusiasts 25-45, interest: specialty coffee, single origin",
        adCopyVariants: [
          "Your coffee was roasted months ago. Ours was roasted this week.",
          "Freshness > Organic. See the roast date on every bag.",
        ],
        strategySummary:
          "Counter-position against organic-focused competitors by emphasizing verifiable freshness.",
        keyRisks: [
          "Cold audience may not understand roast date significance",
          "Need strong visual of printed date to anchor the hook",
        ],
      }),
    );

    const result = await generateCampaignStrategy(brand, market);
    expect(result.recommendedObjective).toBe("traffic");
    expect(result.recommendedBudgetRange.min).toBe(200);
    expect(result.adCopyVariants).toHaveLength(2);
    expect(result.keyRisks).toHaveLength(2);
    expect(routeAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "fast", json: true }),
    );
  });
});

describe("campaign post-mortem (strategy agent)", () => {
  const activeCampaign: CampaignContext = {
    name: "Summer Freshness Push",
    objective: "traffic",
    budget: 500,
    audience: {
      demographics: "25-45 coffee lovers",
      interests: ["specialty coffee", "home brewing"],
      locations: ["US"],
    },
    creativeSummary: "UGC video showing roast date close-up",
    spend: 320,
    impressions: 45000,
    clicks: 1200,
    conversions: 45,
  };

  it("builds post-mortem prompt with performance data", () => {
    const prompt = buildPostMortemPrompt(activeCampaign, market);
    expect(prompt).toContain("Summer Freshness Push");
    expect(prompt).toContain("$320.00");
    expect(prompt).toContain("45,000");
    expect(prompt).toContain("CTR:");
    expect(prompt).toContain("CPC:");
  });

  it("builds strategy-review prompt when no performance data", () => {
    const draftCampaign: CampaignContext = {
      ...activeCampaign,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
    };
    const prompt = buildPostMortemPrompt(draftCampaign, market);
    expect(prompt).toContain("Not yet available");
    expect(prompt).toContain("strategy strength");
  });

  it("generates and parses post-mortem analysis", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        whatWorked: [
          "UGC format drove 2.67% CTR — above industry average",
          "Roast date close-up created strong visual anchor",
        ],
        whatFailed: [
          "Conversion rate (3.75%) suggests landing page friction",
          "Interest targeting too broad — 'home brewing' includes non-buyers",
        ],
        levelUpActions: [
          "Narrow interests to 'single origin' and 'pour over' for next test",
          "A/B test landing page with vs without roast date explainer",
          "Retarget clickers with conversions-optimized campaign",
        ],
        nextIterationBrief:
          "Retargeting campaign for 1,200 site visitors with conversion objective, $200 budget, 7-day window. Same creative, new landing page.",
      }),
    );

    const result = await analyzeCampaignPerformance(activeCampaign, market);
    expect(result.whatWorked).toHaveLength(2);
    expect(result.whatFailed).toHaveLength(2);
    expect(result.levelUpActions).toHaveLength(3);
    expect(result.nextIterationBrief).toContain("Retargeting");
  });
});
