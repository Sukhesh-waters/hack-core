import { describe, expect, it } from "vitest";
import { calculatePlanAttribution } from "./attribution";

describe("calculatePlanAttribution", () => {
  it("handles empty slots", () => {
    const res = calculatePlanAttribution([]);
    expect(res.totalPlanned).toBe(0);
    expect(res.totalPublished).toBe(0);
    expect(res.avgEngagementRate).toBeNull();
  });

  it("calculates accurate publish rate and average engagement rate", () => {
    const res = calculatePlanAttribution([
      {
        slotKey: "2026-08-18:instagram:reels",
        contentId: "c-1",
        title: "Product Launch Reel",
        status: "published",
        publishedDate: new Date(),
        metrics: { engagementRate: 0.045, reach: 1200 },
      },
      {
        slotKey: "2026-08-19:instagram:carousel",
        contentId: "c-2",
        title: "Feature Breakdown Carousel",
        status: "published",
        publishedDate: new Date(),
        metrics: { engagementRate: 0.035, reach: 800 },
      },
      {
        slotKey: "2026-08-20:instagram:story",
        contentId: "c-3",
        title: "Behind the scenes",
        status: "in_review",
        publishedDate: null,
      },
    ]);

    expect(res.totalPlanned).toBe(3);
    expect(res.totalPublished).toBe(2);
    expect(res.publishRate).toBe(66.7);
    expect(res.avgEngagementRate).toBe(0.04);
    expect(res.topPerformingSlot?.contentId).toBe("c-1");
  });
});
