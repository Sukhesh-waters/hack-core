import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { assembleCampaignStrategyContext } from "./campaign-strategy";
import {
  clientBrandContext,
  recentCompetitorAds,
  topAdEligibleContent,
} from "@/db/queries/ad-intelligence";

vi.mock("@/db/queries/ad-intelligence", () => ({
  clientBrandContext: vi.fn(),
  recentCompetitorAds: vi.fn(),
  topAdEligibleContent: vi.fn(),
}));
// Two-layer guardrail: this recipe must never touch first-party post queries.
vi.mock("@/db/queries/posts", () => {
  throw new Error("campaign_strategy context must not import first-party posts");
});

const clientBrandContextMock = clientBrandContext as unknown as Mock;
const recentCompetitorAdsMock = recentCompetitorAds as unknown as Mock;
const topAdEligibleContentMock = topAdEligibleContent as unknown as Mock;

beforeEach(() => {
  clientBrandContextMock.mockReset();
  recentCompetitorAdsMock.mockReset();
  topAdEligibleContentMock.mockReset();

  clientBrandContextMock.mockResolvedValue({
    name: "FreshRoast Coffee",
    handle: "freshroast",
  });
  recentCompetitorAdsMock.mockResolvedValue([
    {
      id: "pad_1",
      pageHandle: "competitor_a",
      adBody: "Stop buying stale coffee",
      adFormat: "video_reel",
      targetAudience: "Coffee lovers 25-45",
      postedAt: new Date("2026-08-01"),
    },
  ]);
  topAdEligibleContentMock.mockResolvedValue([]);
});

describe("assembleCampaignStrategyContext", () => {
  it("assembles brand + public market intelligence", async () => {
    const result = await assembleCampaignStrategyContext({
      workspaceId: "ws_1",
      clientId: "c_1",
    });

    expect(result.state).toBe("context_available");
    if (result.state !== "context_available") return;
    expect(result.context.brand).toEqual({
      brandName: "FreshRoast Coffee",
      positioning: "@freshroast",
    });
    expect(result.context.market).toEqual({
      competitorHooks: ["Stop buying stale coffee"],
      trendingFormats: ["video_reel"],
      audienceInsights: ["Coffee lovers 25-45"],
    });
    expect(result.context.selectedContent).toBeUndefined();
    expect(topAdEligibleContentMock).not.toHaveBeenCalled();
  });

  it("falls back to neutral brand context when the client row is missing", async () => {
    clientBrandContextMock.mockResolvedValue(null);
    recentCompetitorAdsMock.mockResolvedValue([]);

    const result = await assembleCampaignStrategyContext({
      workspaceId: "ws_1",
      clientId: "c_1",
    });

    expect(result.state).toBe("context_available");
    if (result.state !== "context_available") return;
    expect(result.context.brand).toEqual({
      brandName: "Brand",
      positioning: "Social media brand",
    });
    expect(result.context.market.competitorHooks).toEqual([]);
  });

  it("resolves selectedContent when selectedContentId matches a candidate", async () => {
    topAdEligibleContentMock.mockResolvedValue([
      { id: "content_1", title: "Roast Dates Matter", body: "Body text" },
    ]);

    const result = await assembleCampaignStrategyContext({
      workspaceId: "ws_1",
      clientId: "c_1",
      selectedContentId: "content_1",
    });

    expect(result.state).toBe("context_available");
    if (result.state !== "context_available") return;
    expect(result.context.selectedContent).toEqual({
      title: "Roast Dates Matter",
      body: "Body text",
    });
  });

  it("ignores a selectedContentId that matches no candidate", async () => {
    topAdEligibleContentMock.mockResolvedValue([
      { id: "content_1", title: "Other", body: null },
    ]);

    const result = await assembleCampaignStrategyContext({
      workspaceId: "ws_1",
      clientId: "c_1",
      selectedContentId: "missing",
    });

    expect(result.state).toBe("context_available");
    if (result.state !== "context_available") return;
    expect(result.context.selectedContent).toBeUndefined();
  });
});
