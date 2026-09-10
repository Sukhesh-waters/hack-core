import { describe, expect, it } from "vitest";
import { pullMetaCampaignMetrics } from "./meta-ads";

describe("pullMetaCampaignMetrics", () => {
  it("returns zero metrics for draft/pending campaigns", async () => {
    const res = await pullMetaCampaignMetrics({
      campaignId: "camp-1",
      budget: 500,
      status: "draft",
      startDate: new Date(),
    });
    expect(res.spend).toBe(0);
    expect(res.impressions).toBe(0);
    expect(res.clicks).toBe(0);
  });

  it("calculates realistic deterministic metrics for active campaigns without token", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const res = await pullMetaCampaignMetrics({
      campaignId: "camp-2",
      budget: 300,
      status: "active",
      startDate: threeDaysAgo,
    });

    expect(res.spend).toBeGreaterThan(0);
    expect(res.impressions).toBeGreaterThan(0);
    expect(res.clicks).toBeGreaterThan(0);
    expect(res.ctr).toBeGreaterThan(0);
  });
});
