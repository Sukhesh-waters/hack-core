/**
 * Pure data-shaping for the Analytics page (V1). No I/O, no AI call — mirrors
 * src/lib/drift.ts and src/lib/reports.ts's pattern of keeping gating logic
 * testable in isolation from the DB/React layers.
 *
 * Two gates apply here, both constitutional:
 *  - MIN_BASELINE_N (src/lib/scoring.ts): the workspace-wide gate. Below it,
 *    the whole page says "insufficient baseline" instead of drawing a chart
 *    from a handful of points dressed up as a trend.
 *  - Two-layer rule: every input here must already be first-party-only —
 *    enforced upstream by src/db/queries/analytics.ts's source='first_party'
 *    filter, not re-checked here (this module trusts its callers the same
 *    way src/lib/reports.ts does).
 */

import { MIN_BASELINE_N } from "@/lib/scoring";

export type TrendBucket = {
  bucket: string; // ISO timestamp of the week start (date_trunc output)
  posts: number;
  avgEngagement: number | null;
};

export type TrendPoint = {
  bucket: string;
  avgEngagement: number;
};

export type TrendSeries =
  | { status: "insufficient_baseline"; sampleSize: number }
  | { status: "ready"; sampleSize: number; points: TrendPoint[] };

/**
 * Gate + shape the weekly trend. The gate is on TOTAL posts across all
 * buckets (the workspace-wide baseline), not on any individual bucket —
 * a workspace can clear MIN_BASELINE_N in aggregate while still having thin
 * individual weeks; that's fine, the series just point 0 mustn't be shown
 * standalone. Buckets with no scored engagement (avgEngagement null) are
 * dropped from the plotted line rather than rendered as a fabricated 0.
 */
export function buildTrendSeries(
  buckets: TrendBucket[],
  totalPosts: number,
): TrendSeries {
  if (totalPosts < MIN_BASELINE_N) {
    return { status: "insufficient_baseline", sampleSize: totalPosts };
  }
  const points = buckets
    .filter(
      (b): b is TrendBucket & { avgEngagement: number } =>
        b.avgEngagement !== null,
    )
    .map((b) => ({ bucket: b.bucket, avgEngagement: b.avgEngagement }));
  return { status: "ready", sampleSize: totalPosts, points };
}

/** Sparkline geometry: normalize a series of values into 0..1 (for viewBox
 *  coordinates), flat at 0.5 when every value is identical (no fake slope). */
export function normalizeForSparkline(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

export type FormatBar = {
  format: string | null;
  count: number;
  avgEngagement: number | null;
};

/** Bar width as a percentage of the top-performing format, min-floored so a
 *  low-but-real value still renders a visible sliver instead of vanishing. */
export function formatBarWidths(
  formats: FormatBar[],
): Array<FormatBar & { widthPct: number }> {
  const max = Math.max(0, ...formats.map((f) => f.avgEngagement ?? 0));
  return formats.map((f) => ({
    ...f,
    widthPct: max ? Math.max(4, ((f.avgEngagement ?? 0) / max) * 100) : 4,
  }));
}
