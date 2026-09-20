import { describe, expect, it } from "vitest";
import type { PlanDoc } from "@/db/platina-schema";
import { channelKind, layoutTimeline } from "./timeline";

function doc(phases: Array<[number, number]>, totalDays?: number): PlanDoc {
  return {
    summary: "s",
    totalDays: totalDays ?? Math.max(...phases.map(([, e]) => e)),
    phases: phases.map(([startDay, endDay], i) => ({
      id: `p${i + 1}`,
      name: `Phase ${i + 1}`,
      startDay,
      endDay,
      channel: "email",
      message: "m",
    })),
  };
}

describe("layoutTimeline", () => {
  it("positions phases as percentages of the total span", () => {
    const { rows, totalDays } = layoutTimeline(doc([[1, 10], [11, 20]]));
    expect(totalDays).toBe(20);
    expect(rows[0]).toMatchObject({ leftPct: 0, widthPct: 50 });
    expect(rows[1]).toMatchObject({ leftPct: 50, widthPct: 50 });
  });

  it("never lets a bar overflow the axis", () => {
    const { rows } = layoutTimeline(doc([[1, 30], [30, 30]]));
    for (const row of rows) {
      expect(row.leftPct + row.widthPct).toBeLessThanOrEqual(100.0001);
    }
  });

  it("gives a one-day phase a visible minimum width", () => {
    const { rows } = layoutTimeline(doc([[1, 1], [2, 90]]));
    expect(rows[0].widthPct).toBeGreaterThanOrEqual(3);
  });

  it("uses whichever is larger: the declared total or the last phase end", () => {
    expect(layoutTimeline(doc([[1, 5]], 40)).totalDays).toBe(40);
    expect(layoutTimeline(doc([[1, 50]], 10)).totalDays).toBe(50);
  });

  it("keeps the axis readable: about eight ticks or fewer, starting at day 1", () => {
    for (const total of [7, 30, 90, 180]) {
      const { ticks } = layoutTimeline(doc([[1, total]]));
      expect(ticks[0].day).toBe(1);
      expect(ticks.length).toBeLessThanOrEqual(10);
      expect(new Set(ticks.map((t) => t.day)).size).toBe(ticks.length);
    }
  });
});

describe("channelKind", () => {
  it.each([
    ["Email newsletter", "email"],
    ["YouTube", "video"],
    ["Paid social ads", "paid"],
    ["Webinar", "event"],
    ["PR outreach", "press"],
    ["Influencer partnerships", "community"],
    ["LinkedIn", "social"],
    ["Landing page", "web"],
    ["Carrier pigeon", "other"],
  ])("%s -> %s", (channel, kind) => {
    expect(channelKind(channel)).toBe(kind);
  });
});
