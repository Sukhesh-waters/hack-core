import { describe, expect, it } from "vitest";
import {
  MIN_ENGAGEMENT_N,
  describeEngagement,
  median,
  summariseEngagement,
} from "./engagement";

const doc = (metrics: Record<string, number | string> | null, fetchedAt = "2026-09-20T00:00:00Z") => ({
  metrics: metrics as never,
  fetchedAt,
});

describe("median", () => {
  it("takes the middle of an odd sample", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the middle two of an even sample", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for nothing rather than 0", () => {
    expect(median([])).toBeNull();
  });
});

describe("summariseEngagement", () => {
  it("refuses to report below the minimum sample", () => {
    const out = summariseEngagement([doc({ likes: 10 }), doc({ likes: 20 })]);
    expect(out).toEqual({ status: "insufficient", n: 2, needed: MIN_ENGAGEMENT_N });
  });

  it("reports medians with the sample size once there is enough", () => {
    const out = summariseEngagement([
      doc({ likes: 10, comments: 1 }),
      doc({ likes: 30, comments: 3 }),
      doc({ likes: 20, comments: 2 }),
    ]);
    expect(out.status).toBe("ready");
    if (out.status !== "ready") return;
    expect(out.n).toBe(3);
    expect(out.medians.likes).toBe(20);
    expect(out.medians.comments).toBe(2);
  });

  it("does not count a post with no measurements as a zero", () => {
    const out = summariseEngagement([
      doc({ likes: 10 }),
      doc({ likes: 20 }),
      doc({ likes: 30 }),
      doc(null),
      doc({}),
    ]);
    expect(out.status === "ready" && out.n).toBe(3);
    expect(out.status === "ready" && out.medians.likes).toBe(20);
  });

  it("reports a metric only when that metric has its own sample", () => {
    // Views exist on video posts, not on photos: 2 of 3 is not a baseline.
    const out = summariseEngagement([
      doc({ likes: 10, views: 100 }),
      doc({ likes: 20, views: 200 }),
      doc({ likes: 30 }),
    ]);
    expect(out.status === "ready" && out.medians.likes).toBe(20);
    expect(out.status === "ready" && out.medians.views).toBeUndefined();
  });

  it("keeps a measured zero — zero is a measurement", () => {
    const out = summariseEngagement([
      doc({ likes: 0 }),
      doc({ likes: 0 }),
      doc({ likes: 6 }),
    ]);
    expect(out.status === "ready" && out.medians.likes).toBe(0);
  });

  it("reports the window from posting dates when it has them", () => {
    const out = summariseEngagement([
      doc({ likes: 1, postedAt: "2026-09-01T00:00:00Z" }),
      doc({ likes: 2, postedAt: "2026-09-15T00:00:00Z" }),
      doc({ likes: 3, postedAt: "2026-09-10T00:00:00Z" }),
    ]);
    expect(out.status === "ready" && out.window).toEqual({
      from: "2026-09-01",
      to: "2026-09-15",
    });
  });

  it("takes followers as a running total, not a median", () => {
    const out = summariseEngagement([
      doc({ likes: 1, followers: 9000 }),
      doc({ likes: 2, followers: 8000 }),
      doc({ likes: 3, followers: 7000 }),
    ]);
    expect(out.status === "ready" && out.followers).toBe(9000);
  });
});

describe("describeEngagement", () => {
  it("says insufficient baseline instead of a number", () => {
    expect(describeEngagement({ status: "insufficient", n: 2, needed: 3 })).toContain(
      "Insufficient baseline",
    );
    expect(describeEngagement({ status: "insufficient", n: 0, needed: 3 })).toBe(
      "No engagement collected yet.",
    );
  });

  it("never states a figure without its sample size", () => {
    const line = describeEngagement(
      summariseEngagement([doc({ likes: 10 }), doc({ likes: 20 }), doc({ likes: 30 })]),
    );
    expect(line).toContain("20 likes");
    expect(line).toContain("across 3 posts");
  });
});
