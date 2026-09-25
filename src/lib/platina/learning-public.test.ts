import { describe, expect, it } from "vitest";
import { describePublicStat, publicLaneStats, type PublicPostSignal } from "./learning-public";

const now = new Date("2026-09-24T00:00:00Z");
const post = (brandId: string, topic: string, value: number, i: number, metric = "engagement_index"): PublicPostSignal => ({
  brandId,
  topic,
  channel: "linkedin",
  metric,
  signalKind: "interest",
  value,
  observedAt: new Date(now.getTime() - i * 86_400_000),
  sourceUrl: `https://www.linkedin.com/posts/${brandId}_${topic}_${i}`,
});

describe("publicLaneStats (C8.5 public lane)", () => {
  const signals = [
    ...[1.8, 1.4, 1.2, 2.1, 0.7].map((v, i) => post("w", "glp-1", v, i)),
    ...[0.6, 0.9].map((v, i) => post("w", "pfas analysis", v, i)),
    // A competitor's posts and a non-engagement metric never count.
    ...[3, 3, 3, 3, 3].map((v, i) => post("t", "glp-1", v, i)),
    post("w", "glp-1", 9, 1, "ad_days_running"),
  ];
  const stats = publicLaneStats(signals, "w", { now, halfLifeDays: 90, minN: 5 });

  it("learns from the client's own posts only: beat its typical post = worked", () => {
    const glp = stats.find((s) => s.value === "glp-1")!;
    expect(glp).toMatchObject({ n: 5, worked: 4, failed: 1, status: "ok" });
    expect(stats.find((s) => s.value === "pfas analysis")).toMatchObject({ n: 2, status: "insufficient" });
  });

  it("labels every line as public data and gives no direction below min-N", () => {
    expect(describePublicStat(stats.find((s) => s.value === "glp-1")!, "Waters", 5)).toMatch(/4 of 5 beat it \(80%\) \(public data\)$/);
    expect(describePublicStat(stats.find((s) => s.value === "pfas analysis")!, "Waters", 5)).toBe(
      "Waters' posts on pfas analysis: 2 so far, needs 5 (public data)",
    );
  });
});
