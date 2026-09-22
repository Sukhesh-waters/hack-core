/**
 * Opportunities re-ranked by the client's own confirmed results (C6 L6).
 * Pure.
 *
 * A campaign is credited through its topic and its own opportunity key. The
 * "Your results" lines are first-party (Plane A) and are shown apart from the
 * campaign's public proofs (Plane B): never merged into one explanation
 * (two-layer rule).
 */
import { describeStat, rankWithLearning, type FeatureStat } from "./learning";
import type { Campaign } from "./opportunities";

export type LearnedCampaign = Campaign & {
  learned: {
    /** First-party lines: what this client's own results say about it. */
    lines: string[];
    /** Given a slot to try something new (no results yet). */
    explore: boolean;
    movement: "up" | "down" | "none";
  };
};

export function learnCampaigns(
  campaigns: Campaign[],
  options: { stats: FeatureStat[]; minN: number; exploreShare: number; seed: string },
): LearnedCampaign[] {
  return rankWithLearning(campaigns, {
    featuresOf: (c) => ({ topic: c.creativeTopic, opportunity: c.key }),
    stats: options.stats,
    seed: options.seed,
    exploreShare: options.exploreShare,
  }).map((r) => ({
    ...r.item,
    learned: {
      lines: r.basis.map((s) => describeStat(s, options.minN)),
      explore: r.explore,
      movement: r.movement,
    },
  }));
}
