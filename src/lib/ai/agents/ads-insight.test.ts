import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { analyzeCompetitorAds, type PatternAdInput } from "./critic";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

const AD_FIXTURE: PatternAdInput[] = [
  {
    id: "pad_1",
    pageHandle: "competitor_a",
    adBody: "Stop wasting money on bad coffee beans.",
    adFormat: "video_reel",
    targetAudience: "Coffee lovers 25-45",
    postedAtIso: "2026-08-01T00:00:00Z",
  },
];

beforeEach(() => routeAIMock.mockReset());

describe("analyzeCompetitorAds (critic agent)", () => {
  it("returns fallback for empty ad input list without calling routeAI", async () => {
    const res = await analyzeCompetitorAds([]);
    expect(res.summary).toContain("No competitor ads");
    expect(routeAIMock).not.toHaveBeenCalled();
  });

  it("filters citations to valid input pattern_ads IDs", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        summary: "Competitor relies heavily on problem-solution hooks.",
        hooksObserved: ["Stop wasting money"],
        formatBreakdown: ["video_reel"],
        citations: ["pad_1", "hallucinated_id"],
      }),
    );

    const res = await analyzeCompetitorAds(AD_FIXTURE);
    expect(res.citations).toEqual(["pad_1"]);
    expect(res.citations).not.toContain("hallucinated_id");
  });
});
