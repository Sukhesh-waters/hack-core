import { describe, expect, it } from "vitest";
import { summariseCreatives } from "./results-view";

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const creative = (id: string, postedDaysAgo: number, brandId = "b1") => ({
  id,
  brandId,
  title: id,
  channel: "linkedin",
  format: "carousel",
  topic: null,
  hookType: null,
  hypothesis: "h",
  postedAt: daysAgo(postedDaysAgo),
  createdAt: daysAgo(postedDaysAgo),
});

const metric = (creativeId: string, engagements: number, impressions = 1000) => ({
  creativeId,
  capturedAt: daysAgo(0),
  impressions,
  reach: null,
  clicks: null,
  engagements,
  saves: null,
  shares: null,
  videoViews: null,
  leads: null,
  spend: null,
});

describe("summariseCreatives", () => {
  it("walks the loop: no numbers -> measuring -> review waiting -> learned", () => {
    const out = summariseCreatives({
      creatives: [creative("none", 1), creative("fresh", 2), creative("due", 9), creative("done", 20)],
      metrics: [metric("fresh", 10), metric("due", 10), metric("done", 10)],
      reviews: [{ creativeId: "done", status: "confirmed", verdict: "worked" }],
      minN: 5,
      reviewAfterDays: 7,
      now: NOW,
    });
    expect(out.map((s) => s.stage)).toEqual(["no_numbers", "measuring", "review_waiting", "learned"]);
    expect(out[1].reviewInDays).toBe(5);
    expect(out[3].verdict).toBe("worked");
  });

  it("compares with the same client's usual post only past min-N", () => {
    const peers = ["p1", "p2", "p3", "p4", "p5"].map((id) => creative(id, 3));
    const out = summariseCreatives({
      creatives: [creative("me", 3), ...peers, creative("other-client", 3, "b2")],
      metrics: [metric("me", 40), ...peers.map((p) => metric(p.id, 20)), metric("other-client", 1)],
      reviews: [],
      minN: 5,
      reviewAfterDays: 7,
      now: NOW,
    });
    expect(out[0].index).toBeCloseTo(2);
    // The other client has no peers of its own: no comparison.
    expect(out[6].index).toBeNull();
  });
});
