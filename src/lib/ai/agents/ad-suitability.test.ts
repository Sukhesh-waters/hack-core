import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buildAdSuitabilityPrompt,
  evaluateContentForAds,
  type OrganicContentItem,
  type MarketTrendContext,
} from "./critic";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

beforeEach(() => routeAIMock.mockReset());

const sampleContent: OrganicContentItem[] = [
  {
    id: "c_001",
    title: "5 Morning Routines That Changed My Skin",
    body: "Start your day with these science-backed skincare steps.",
    type: "carousel",
    pillar: "education",
    engagementRate: 0.045,
  },
  {
    id: "c_002",
    title: "New Collection Drop",
    body: "Introducing our summer line — lightweight hydration for every skin type.",
    type: "reel",
    pillar: "product",
    engagementRate: 0.032,
  },
];

const sampleMarket: MarketTrendContext = {
  hooksObserved: ["problem-solution", "before-after transformation"],
  formatBreakdown: ["carousel", "short video"],
  topAudiences: ["Women 25-45 skincare-interested"],
};

describe("ad-suitability (critic agent)", () => {
  it("returns empty array for empty content", async () => {
    const result = await evaluateContentForAds([], sampleMarket);
    expect(result).toEqual([]);
    expect(routeAIMock).not.toHaveBeenCalled();
  });

  it("builds prompt with content items and market context", () => {
    const prompt = buildAdSuitabilityPrompt(sampleContent, sampleMarket);
    expect(prompt).toContain("[Content ID: c_001]");
    expect(prompt).toContain("5 Morning Routines");
    expect(prompt).toContain("problem-solution");
    expect(prompt).toContain("Women 25-45");
    expect(prompt).toContain("engagement: 4.5%");
  });

  it("parses and filters valid suitability rankings", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        rankings: [
          {
            contentId: "c_001",
            suitabilityScore: 82,
            hookStrength: 85,
            commercialIntent: 70,
            ctaQuality: 80,
            audienceAlignment: 90,
            reasoning:
              "Problem-solution format aligns with trending hooks. Strong educational angle.",
            suggestedAdCopy:
              "Your morning routine is ruining your skin. Here are 5 fixes backed by dermatologists.",
            suggestedObjective: "traffic",
          },
          {
            contentId: "c_002",
            suitabilityScore: 68,
            hookStrength: 60,
            commercialIntent: 85,
            ctaQuality: 65,
            audienceAlignment: 60,
            reasoning: "High commercial intent but weak hook for cold audience.",
            suggestedAdCopy: "Lightweight hydration that lasts all summer.",
            suggestedObjective: "conversions",
          },
          {
            contentId: "c_HALLUCINATED",
            suitabilityScore: 95,
            hookStrength: 95,
            commercialIntent: 95,
            ctaQuality: 95,
            audienceAlignment: 95,
            reasoning: "Hallucinated",
            suggestedAdCopy: "Fake Ad Copy",
            suggestedObjective: "awareness",
          },
        ],
      }),
    );

    const result = await evaluateContentForAds(sampleContent, sampleMarket);

    // Hallucinated ID filtered out
    expect(result).toHaveLength(2);
    expect(result[0].contentId).toBe("c_001");
    expect(result[0].suitabilityScore).toBe(82);
    expect(result[1].contentId).toBe("c_002");
    // Uses fast tier
    expect(routeAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "fast", json: true }),
    );
  });

  it("provides default market context when empty", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        rankings: [
          {
            contentId: "c_001",
            suitabilityScore: 55,
            hookStrength: 50,
            commercialIntent: 50,
            ctaQuality: 60,
            audienceAlignment: 60,
            reasoning: "Decent educational content.",
            suggestedAdCopy: "Fix your skin routine.",
            suggestedObjective: "awareness",
          },
        ],
      }),
    );

    const emptyMarket: MarketTrendContext = {
      hooksObserved: [],
      formatBreakdown: [],
      topAudiences: [],
    };

    const result = await evaluateContentForAds([sampleContent[0]], emptyMarket);
    expect(result).toHaveLength(1);
    // Prompt should have used defaults
    const call = routeAIMock.mock.calls[0][0];
    expect(call.prompt).toContain("problem-solution");
  });
});
