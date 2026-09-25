import { describe, expect, it } from "vitest";
import {
  decayWeight,
  describeStat,
  featureStats,
  learningSeed,
  normaliseValue,
  rankWithLearning,
  sampleBeta,
  seededRandom,
  weekdayOf,
  type LearnedResult,
} from "./learning";

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function results(topic: string, verdicts: LearnedResult["verdict"][], age = 1, extra: Partial<LearnedResult["features"]> = {}) {
  return verdicts.map((verdict, i) => ({
    creativeId: `${topic}-${i}`,
    verdict,
    confirmedAt: daysAgo(age),
    features: { topic, ...extra },
  }));
}

const opts = { now: NOW, halfLifeDays: 90, minN: 5 };

describe("featureStats", () => {
  it("counts per feature value, normalised, with a Beta posterior", () => {
    const stats = featureStats(
      [...results("Mass Spectrometry", ["worked", "worked", "failed"]), ...results("mass  spectrometry", ["mixed"])],
      opts,
    );
    const ms = stats.find((s) => s.feature === "topic")!;
    expect(ms).toMatchObject({ value: "mass spectrometry", n: 4, worked: 2, mixed: 1, failed: 1, status: "insufficient" });
    expect(ms.mean).toBeCloseTo((1 + 2.5 * decayWeight(1, 90)) / (2 + 4 * decayWeight(1, 90)), 5);
  });

  it("passes the min-N gate at exactly minN results", () => {
    const stats = featureStats(results("lc", ["worked", "worked", "worked", "worked", "worked"]), opts);
    expect(stats[0].status).toBe("ok");
    expect(stats[0].low).toBeGreaterThan(0.5);
  });

  it("old results fade: a year-old failure weighs far less than a recent win", () => {
    expect(decayWeight(90, 90)).toBeCloseTo(0.5);
    const stats = featureStats(
      [...results("gc", ["failed", "failed", "failed"], 365), ...results("gc", ["worked", "worked"], 1)],
      opts,
    );
    expect(stats[0].mean).toBeGreaterThan(0.5);
  });

  it("describes below the gate without any direction", () => {
    const [stat] = featureStats(results("lc", ["worked", "worked"]), opts);
    const text = describeStat(stat, 5);
    expect(text).toContain("needs 5");
    expect(text).not.toMatch(/beat|trail/);
  });
});

describe("sampling", () => {
  it("is deterministic per seed", () => {
    const a = seededRandom("x");
    const b = seededRandom("x");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("Beta samples centre on the mean", () => {
    const rng = seededRandom("beta");
    let sum = 0;
    for (let i = 0; i < 4000; i += 1) sum += sampleBeta(8, 2, rng);
    expect(sum / 4000).toBeCloseTo(0.8, 1);
  });

  it("seed is stable within a day and changes the next day", () => {
    expect(learningSeed("ws", NOW)).toBe(learningSeed("ws", new Date("2026-09-22T23:00:00Z")));
    expect(learningSeed("ws", NOW)).not.toBe(learningSeed("ws", new Date("2026-09-23T01:00:00Z")));
  });
});

describe("rankWithLearning — C6 acceptance: a recorded result changes the next ranking", () => {
  const items = [{ key: "topic:gc" }, { key: "topic:lc" }, { key: "topic:ms" }];
  const featuresOf = (i: { key: string }) => ({ topic: i.key.slice(6) });
  const seed = learningSeed("ws", NOW);

  it("with no results the rule order is kept", () => {
    const ranked = rankWithLearning(items, { featuresOf, stats: [], seed, exploreShare: 0 });
    expect(ranked.map((r) => r.item.key)).toEqual(["topic:gc", "topic:lc", "topic:ms"]);
    expect(ranked.every((r) => r.movement === "none" && r.basis.length === 0)).toBe(true);
  });

  it("confirmed wins lift an item and confirmed failures sink one", () => {
    const stats = featureStats(
      [
        ...results("ms", ["worked", "worked", "worked", "worked", "worked", "worked"]),
        ...results("gc", ["failed", "failed", "failed", "failed", "failed", "failed"]),
      ],
      opts,
    );
    const ranked = rankWithLearning(items, { featuresOf, stats, seed, exploreShare: 0 });
    expect(ranked.map((r) => r.item.key)).toEqual(["topic:ms", "topic:lc", "topic:gc"]);
    expect(ranked[0]).toMatchObject({ movement: "up" });
    expect(ranked[2]).toMatchObject({ movement: "down" });
    expect(ranked[0].basis[0].value).toBe("ms");
  });

  it("below the min-N gate nothing moves, whatever the results say", () => {
    const stats = featureStats(
      [...results("ms", ["worked", "worked", "worked", "worked"]), ...results("gc", ["failed", "failed", "failed", "failed"])],
      opts,
    );
    const ranked = rankWithLearning(items, { featuresOf, stats, seed, exploreShare: 0 });
    expect(ranked.map((r) => r.item.key)).toEqual(["topic:gc", "topic:lc", "topic:ms"]);
  });

  it("the same data and day give the same order (no flicker on reload)", () => {
    const stats = featureStats(results("lc", ["worked", "mixed", "failed", "worked", "mixed"]), opts);
    const a = rankWithLearning(items, { featuresOf, stats, seed, exploreShare: 0 }).map((r) => r.item.key);
    const b = rankWithLearning(items, { featuresOf, stats, seed, exploreShare: 0 }).map((r) => r.item.key);
    expect(a).toEqual(b);
  });

  it("explore keeps an untested item in every block, labelled", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((t) => ({ key: `topic:${t}` }));
    const stats = featureStats(
      ["a", "b", "c", "d", "e"].flatMap((t) => results(t, ["worked", "worked", "worked", "worked", "worked"])),
      opts,
    );
    const ranked = rankWithLearning(many, { featuresOf, stats, seed, exploreShare: 0.2 });
    const firstBlock = ranked.slice(0, 5);
    const explored = firstBlock.find((r) => r.explore);
    expect(explored?.item.key).toBe("topic:f");
    expect(explored?.basis).toEqual([]);
  });
});

describe("helpers", () => {
  it("normalise and weekday", () => {
    expect(normaliseValue("  Carousel  Post ")).toBe("carousel post");
    expect(normaliseValue("  ")).toBeNull();
    expect(weekdayOf(new Date("2026-09-22T08:00:00Z"))).toBe("tuesday");
  });
});
