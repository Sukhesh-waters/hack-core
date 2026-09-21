/**
 * Engagement aggregation (core spine R4). Pure.
 *
 * The `metrics` column has been written since S3 and read by nothing: the
 * owner's "posts / impressions analysis" was stored and dropped on the floor.
 * This turns a set of collected social documents into figures that can be
 * shown — with the sample size they rest on, and the minimum-N gate the
 * constitution requires. Below the floor it says "insufficient baseline"; it
 * never invents a number.
 *
 * Median, not mean: one viral post should not redraw a competitor's baseline.
 */
import type { PlatinaSignalMetrics } from "@/db/platina-schema";

export type EngagementDoc = {
  metrics?: PlatinaSignalMetrics | null;
  fetchedAt: Date | string;
};

export type EngagementMetric = "likes" | "comments" | "views" | "shares";

export type EngagementSummary =
  | { status: "insufficient"; n: number; needed: number }
  | {
      status: "ready";
      n: number;
      medians: Partial<Record<EngagementMetric, number>>;
      followers: number | null;
      /** ISO dates of the oldest and newest post in the sample. */
      window: { from: string; to: string } | null;
    };

/** Fewer posts than this is an anecdote, not a baseline. */
export const MIN_ENGAGEMENT_N = 3;

const METRICS: EngagementMetric[] = ["likes", "comments", "views", "shares"];

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

/**
 * `n` counts documents that carried at least one measurement — a post with no
 * metrics is not a zero, it is an absence, and counting it would drag every
 * median toward a number nobody measured.
 */
export function summariseEngagement(
  docs: EngagementDoc[],
  minN: number = MIN_ENGAGEMENT_N,
): EngagementSummary {
  const measured = docs.filter(
    (doc) => doc.metrics && METRICS.some((key) => typeof doc.metrics?.[key] === "number"),
  );
  if (measured.length < minN) {
    return { status: "insufficient", n: measured.length, needed: minN };
  }

  const medians: Partial<Record<EngagementMetric, number>> = {};
  for (const key of METRICS) {
    const values = measured
      .map((doc) => doc.metrics?.[key])
      .filter((value): value is number => typeof value === "number");
    // Each metric carries its own sample: views exist on video, not on photos.
    if (values.length >= minN) {
      const value = median(values);
      if (value !== null) medians[key] = value;
    }
  }

  const followerCounts = docs
    .map((doc) => doc.metrics?.followers)
    .filter((value): value is number => typeof value === "number");

  const dates = measured
    .map((doc) => doc.metrics?.postedAt ?? doc.fetchedAt)
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  return {
    status: "ready",
    n: measured.length,
    medians,
    // The newest follower count, not a median: it is a running total.
    followers: followerCounts.length > 0 ? followerCounts[0] : null,
    window:
      dates.length > 0
        ? {
            from: new Date(dates[0]).toISOString().slice(0, 10),
            to: new Date(dates[dates.length - 1]).toISOString().slice(0, 10),
          }
        : null,
  };
}

/** One line for the UI. Never a number without its sample size. */
export function describeEngagement(summary: EngagementSummary): string {
  if (summary.status === "insufficient") {
    return summary.n === 0
      ? "No engagement collected yet."
      : `Insufficient baseline: ${summary.n} post${summary.n === 1 ? "" : "s"} with numbers, ${summary.needed} needed.`;
  }
  const parts = METRICS.filter((key) => summary.medians[key] !== undefined).map(
    (key) => `${summary.medians[key]} ${key}`,
  );
  const window = summary.window ? ` (${summary.window.from} to ${summary.window.to})` : "";
  return `Median ${parts.join(", ")} across ${summary.n} posts${window}.`;
}
