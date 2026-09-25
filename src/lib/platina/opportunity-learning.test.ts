import { describe, expect, it } from "vitest";
import { featureStats, learningSeed, type LearnedResult } from "./learning";
import { learnCampaigns } from "./opportunity-learning";
import type { Campaign } from "./opportunities";

const NOW = new Date("2026-09-22T12:00:00Z");

const campaign = (topic: string): Campaign => ({
  key: `topic:${topic}`,
  channel: "online",
  source: "topic",
  title: `Campaign on ${topic}`,
  why: [`${topic} posts beat the typical post`],
  proofs: [{ label: "post", url: `https://linkedin.com/${topic}` }],
  timing: null,
  plan: { useCase: "client", goal: topic },
  creativeTopic: topic,
  factors: [],
});

const confirmed = (topic: string, verdict: LearnedResult["verdict"], n: number): LearnedResult[] =>
  Array.from({ length: n }, (_, i) => ({
    creativeId: `${topic}-${i}`,
    verdict,
    confirmedAt: NOW,
    features: { topic, channel: "linkedin", format: "carousel" },
  }));

describe("C6 acceptance: a recorded result changes the next Opportunities ranking", () => {
  const campaigns = [campaign("gas chromatography"), campaign("hplc"), campaign("mass spectrometry")];
  const base = { minN: 5, exploreShare: 0, seed: learningSeed("ws", NOW) };

  it("before any result: the rule order, no first-party lines", () => {
    const out = learnCampaigns(campaigns, { ...base, stats: [] });
    expect(out.map((c) => c.creativeTopic)).toEqual(["gas chromatography", "hplc", "mass spectrometry"]);
    expect(out.every((c) => c.learned.lines.length === 0)).toBe(true);
  });

  it("after confirmed wins on mass spectrometry and failures on GC, the order changes and says why", () => {
    const stats = featureStats(
      [...confirmed("mass spectrometry", "worked", 6), ...confirmed("gas chromatography", "failed", 6)],
      { now: NOW, halfLifeDays: 90, minN: 5 },
    );
    const out = learnCampaigns(campaigns, { ...base, stats });
    expect(out[0].creativeTopic).toBe("mass spectrometry");
    expect(out[0].learned.movement).toBe("up");
    expect(out[0].learned.lines[0]).toContain("tends to beat your usual post");
    expect(out.at(-1)?.creativeTopic).toBe("gas chromatography");
    // Public proofs are untouched: the first-party lines sit beside them, never inside.
    expect(out[0].proofs).toEqual(campaigns[2].proofs);
    expect(out[0].why).toEqual(campaigns[2].why);
  });

  it("an explored campaign is labelled", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(campaign);
    const stats = featureStats(
      ["a", "b", "c", "d", "e"].flatMap((t) => confirmed(t, "worked", 5)),
      { now: NOW, halfLifeDays: 90, minN: 5 },
    );
    const out = learnCampaigns(many, { ...base, exploreShare: 0.2, stats });
    expect(out.slice(0, 5).some((c) => c.learned.explore && c.creativeTopic === "f")).toBe(true);
  });
});
