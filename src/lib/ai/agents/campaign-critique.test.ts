import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buildCampaignCritiquePrompt,
  CampaignCritiqueError,
  critiqueCampaignStrategy,
} from "./critic";
import type {
  BrandContext,
  CampaignStrategy,
  MarketIntelligence,
} from "./strategy";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

beforeEach(() => routeAIMock.mockReset());

const brand: BrandContext = {
  brandName: "FreshRoast Coffee",
  positioning: "Specialty coffee with printed roast dates",
};

const market: MarketIntelligence = {
  competitorHooks: ["Stop buying stale coffee"],
  trendingFormats: ["UGC short video"],
  audienceInsights: ["Coffee enthusiasts 25-45"],
};

const strategy: CampaignStrategy = {
  recommendedObjective: "conversions",
  recommendedBudgetRange: { min: 50, max: 100 },
  audienceSuggestion: "Coffee enthusiasts 25-45 who buy single origin",
  adCopyVariants: ["Roasted this week, not last year."],
  strategySummary: "Lead with verifiable freshness against stale competitors.",
  keyRisks: ["Cold audience unfamiliar with roast dates"],
};

describe("buildCampaignCritiquePrompt", () => {
  it("includes the proposal and the exact market context the strategist saw", () => {
    const prompt = buildCampaignCritiquePrompt(strategy, brand, market);
    expect(prompt).toContain("FreshRoast Coffee");
    expect(prompt).toContain("Stop buying stale coffee");
    expect(prompt).toContain("$50-$100");
    expect(prompt).toContain("conversions");
    expect(prompt).toContain("Cold audience unfamiliar");
  });
});

describe("critiqueCampaignStrategy", () => {
  it("can challenge a weak strategy: returns flagged with feedback", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        verdict: "flagged",
        feedback: ["A $50-$100 budget is too thin for a conversions objective."],
      }),
    );

    const result = await critiqueCampaignStrategy(strategy, brand, market);

    expect(result.verdict).toBe("flagged");
    expect(result.feedback).toHaveLength(1);
    expect(routeAIMock.mock.calls[0][0]).toMatchObject({
      kind: "chat",
      tier: "fast",
      json: true,
    });
  });

  it("returns pass with empty feedback for a sound plan", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({ verdict: "pass", feedback: [] }),
    );
    const result = await critiqueCampaignStrategy(strategy, brand, market);
    expect(result).toEqual({ verdict: "pass", feedback: [] });
  });

  it("rejects unusable model output with CampaignCritiqueError", async () => {
    routeAIMock.mockResolvedValue("not json");
    await expect(
      critiqueCampaignStrategy(strategy, brand, market),
    ).rejects.toBeInstanceOf(CampaignCritiqueError);
  });

  it("rejects an out-of-schema verdict", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({ verdict: "maybe", feedback: [] }),
    );
    await expect(
      critiqueCampaignStrategy(strategy, brand, market),
    ).rejects.toBeInstanceOf(CampaignCritiqueError);
  });
});
