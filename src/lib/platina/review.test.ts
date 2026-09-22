import { describe, expect, it } from "vitest";
import type { PlanEvidenceSnapshot } from "@/db/platina-schema";
import {
  buildReviewPrompt,
  computeReviewFacts,
  engagementRate,
  lessonText,
  median,
  parseReviewDraft,
  planBacktrack,
  promotedConfidence,
  reviewDue,
  suggestVerdict,
  type MetricSnapshot,
  type ReviewCreative,
} from "./review";

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const creative: ReviewCreative = {
  id: "c1",
  title: "GLP-1 QC carousel",
  channel: "linkedin",
  format: "carousel",
  topic: "mass spectrometry",
  hookType: "proof",
  hypothesis: "QC managers engage with proof of speed, as the GLP-1 interest signal shows",
  postedAt: daysAgo(8),
  createdAt: daysAgo(9),
};

function snap(over: Partial<MetricSnapshot>): MetricSnapshot {
  return {
    capturedAt: daysAgo(1),
    impressions: null,
    reach: null,
    clicks: null,
    engagements: null,
    saves: null,
    shares: null,
    videoViews: null,
    leads: null,
    spend: null,
    ...over,
  };
}

describe("engagement rate", () => {
  it("engagements per impression, reach as fallback, null when a side is missing (never 0)", () => {
    expect(engagementRate(snap({ engagements: 30, impressions: 1000 }))).toBeCloseTo(0.03);
    expect(engagementRate(snap({ engagements: 30, reach: 600 }))).toBeCloseTo(0.05);
    expect(engagementRate(snap({ impressions: 1000 }))).toBeNull();
    expect(engagementRate(snap({ engagements: 5 }))).toBeNull();
    expect(engagementRate(null)).toBeNull();
  });

  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("computeReviewFacts + suggestVerdict", () => {
  const peers = [0.02, 0.02, 0.02, 0.02, 0.02];

  it("compares the latest snapshot with the client's usual post", () => {
    const facts = computeReviewFacts({
      creative,
      snapshots: [snap({ capturedAt: daysAgo(5), engagements: 10, impressions: 1000 }), snap({ engagements: 30, impressions: 1000 })],
      peerRates: [...peers, null],
      minN: 5,
      now: NOW,
    });
    expect(facts).toMatchObject({ snapshots: 2, days: 8, impressions: 1000, baselineN: 5, beatMedian: true });
    expect(facts.index).toBeCloseTo(1.5);
    expect(suggestVerdict(facts)).toBe("worked");
  });

  it("below min-N: no index, no suggested verdict", () => {
    const facts = computeReviewFacts({
      creative,
      snapshots: [snap({ engagements: 30, impressions: 1000 })],
      peerRates: [0.02, 0.02],
      minN: 5,
      now: NOW,
    });
    expect(facts.index).toBeNull();
    expect(facts.beatMedian).toBeNull();
    expect(suggestVerdict(facts)).toBeNull();
  });

  it("thresholds: failed at or below 0.9x, mixed between", () => {
    const at = (rate: number) =>
      suggestVerdict(
        computeReviewFacts({ creative, snapshots: [snap({ engagements: rate * 1000, impressions: 1000 })], peerRates: peers, minN: 5, now: NOW }),
      );
    expect(at(0.018)).toBe("failed");
    expect(at(0.02)).toBe("mixed");
    expect(at(0.022)).toBe("worked");
  });
});

describe("reviewDue", () => {
  it("opens after the wait, only with numbers, only once", () => {
    const s = [snap({ engagements: 1, impressions: 10 })];
    expect(reviewDue({ creative, snapshots: s, reviewAfterDays: 7, hasReview: false, now: NOW })).toBe(true);
    expect(reviewDue({ creative, snapshots: [], reviewAfterDays: 7, hasReview: false, now: NOW })).toBe(false);
    expect(reviewDue({ creative, snapshots: s, reviewAfterDays: 10, hasReview: false, now: NOW })).toBe(false);
    expect(reviewDue({ creative, snapshots: s, reviewAfterDays: 7, hasReview: true, now: NOW })).toBe(false);
  });
});

describe("model draft", () => {
  it("prompt carries the computed facts and forbids new numbers", () => {
    const facts = computeReviewFacts({
      creative,
      snapshots: [snap({ engagements: 30, impressions: 1000 })],
      peerRates: [0.02, 0.02, 0.02, 0.02, 0.02],
      minN: 5,
      now: NOW,
    });
    const prompt = buildReviewPrompt({ clientName: "Waters", creative, facts, minN: 5, evidence: [] });
    expect(prompt).toContain("3.00%");
    expect(prompt).toContain("1.50x");
    expect(prompt).toContain("never state a number that is not in the facts");
    expect(prompt).toContain(creative.hypothesis);
  });

  it("parses a valid draft and rejects an invalid one", () => {
    const ok = parseReviewDraft(
      'Sure: {"verdict":"worked","what":"It beat the usual post.","why":[{"factor":"hook","effect":"helped","reason":"likely the proof hook"}],"how":"Test the same hook as video.","keep":"proof-led hooks"}',
    );
    expect(ok?.why[0]).toEqual({ factor: "hook", effect: "helped", reason: "likely the proof hook" });
    expect(parseReviewDraft('{"what":"x","why":[{"factor":"luck","effect":"helped","reason":"r"}],"how":"y"}')).toBeNull();
    expect(parseReviewDraft("not json")).toBeNull();
  });
});

describe("backtracking", () => {
  const evidence: PlanEvidenceSnapshot[] = [
    { id: "brain-1", plane: "B", content: "GLP-1 interest up", sourceUrl: null, collectedAt: null, confidence: 0.7 },
    { id: "brain-2", plane: "B", content: "MS posts beat median", sourceUrl: null, collectedAt: null, confidence: 0.6 },
    { id: "own-1", plane: "A", content: "Waters sells Xevo", sourceUrl: null, collectedAt: null, confidence: null },
  ];

  it("failed demotes only the public insights the phase cited, never first-party facts", () => {
    expect(planBacktrack({ verdict: "failed", evidence })).toEqual({ demote: ["brain-1", "brain-2"], promote: [] });
  });

  it("the reviewer's ticks decide: an unticked insight is left alone", () => {
    expect(planBacktrack({ verdict: "failed", evidence, keep: new Set(["brain-2"]) })).toEqual({ demote: ["brain-2"], promote: [] });
  });

  it("worked promotes, mixed moves nothing; promotion is capped", () => {
    expect(planBacktrack({ verdict: "worked", evidence }).promote).toEqual(["brain-1", "brain-2"]);
    expect(planBacktrack({ verdict: "mixed", evidence })).toEqual({ demote: [], promote: [] });
    expect(promotedConfidence(0.93)).toBe(0.95);
    expect(promotedConfidence(0.5)).toBeCloseTo(0.55);
  });

  it("lesson text is citable, first-party and carries the measured index", () => {
    const facts = computeReviewFacts({
      creative,
      snapshots: [snap({ engagements: 30, impressions: 1000 })],
      peerRates: [0.02, 0.02, 0.02, 0.02, 0.02],
      minN: 5,
      now: NOW,
    });
    const text = lessonText({
      creative,
      verdict: "worked",
      facts,
      what: "Beat the usual post.",
      why: [{ factor: "hook", effect: "helped", reason: "proof of speed" }],
      how: "Try it as a video.",
      keep: "Proof hooks",
    });
    expect(text).toContain('Result of "GLP-1 QC carousel" (worked)');
    expect(text).toContain("measured: 1.50x");
    expect(text).toContain("hook helped: proof of speed");
  });
});
