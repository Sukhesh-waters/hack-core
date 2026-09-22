/**
 * Reading the learning state (C6 L5): config, confirmed results, feature
 * stats. No writes and no realtime, so the planner and pages can import it.
 */
import { getWorkspaceConfig } from "@/db/queries/platina";
import { listConfirmedResults } from "@/db/queries/platina-learning";
import {
  describeStat,
  featureStats,
  normaliseValue,
  weekdayOf,
  type FeatureStat,
  type FeatureValues,
  type LearnedResult,
} from "./learning";

export type LearningConfig = { minN: number; exploreShare: number; reviewAfterDays: number; halfLifeDays: number };

export async function learningConfig(workspaceId: string): Promise<LearningConfig> {
  const c = await getWorkspaceConfig(workspaceId);
  return {
    minN: c?.learningMinN ?? 5,
    exploreShare: c?.learningExploreShare ?? 0.2,
    reviewAfterDays: c?.reviewAfterDays ?? 7,
    halfLifeDays: c?.learningHalfLifeDays ?? 90,
  };
}

/** The features a creative's result is credited to. */
export function creativeFeatures(c: {
  topic: string | null;
  channel: string;
  format: string;
  hookType: string | null;
  postedAt: Date | null;
  opportunityKey: string | null;
}): FeatureValues {
  return {
    topic: c.topic,
    channel: c.channel,
    format: c.format,
    hook: c.hookType,
    weekday: weekdayOf(c.postedAt),
    opportunity: c.opportunityKey,
  };
}

/** Confirmed results as the engine's input. */
export async function learnedResults(workspaceId: string, brandId?: string | null): Promise<LearnedResult[]> {
  const rows = await listConfirmedResults(workspaceId, brandId);
  return rows
    .filter((r) => r.verdict && r.confirmedAt)
    .map((r) => ({
      creativeId: r.creativeId,
      verdict: r.verdict!,
      confirmedAt: r.confirmedAt!,
      features: creativeFeatures(r),
    }));
}

export type LearningState = { config: LearningConfig; stats: FeatureStat[]; results: number };

export async function learningState(workspaceId: string, brandId?: string | null, now = new Date()): Promise<LearningState> {
  const [config, results] = await Promise.all([learningConfig(workspaceId), learnedResults(workspaceId, brandId)]);
  return {
    config,
    results: results.length,
    stats: featureStats(results, { now, halfLifeDays: config.halfLifeDays, minN: config.minN }),
  };
}

/** The stats that apply to a topic (for "Your results" lines). */
export function statsForTopic(stats: FeatureStat[], topic: string | null | undefined, opportunityKey?: string): FeatureStat[] {
  const t = normaliseValue(topic);
  const o = normaliseValue(opportunityKey);
  return stats.filter(
    (s) => (s.feature === "topic" && s.value === t) || (o !== null && s.feature === "opportunity" && s.value === o),
  );
}


/** Plain lines for the planner: only values past the min-N gate. */
export function learnedPatternLines(state: LearningState): string[] {
  return state.stats.filter((s) => s.status === "ok").map((s) => describeStat(s, state.config.minN));
}
