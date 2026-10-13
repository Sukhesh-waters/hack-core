/**
 * The falsifier metric registry (Metacognitive Brain plan, B0). Pure,
 * DB-free — data access is injected (see falsifier-metrics-deps.ts for the
 * real implementation).
 *
 * The brief's rule: "no insight without a testable falsifier." A falsifier
 * is only testable if it names a metric this system actually measures, over
 * a window the metric's own data makes meaningful, on a segment that exists.
 * This file is the one place that says what those metrics are, derived from
 * how the code already measures them today (interest.ts, market-insights.ts,
 * review.ts) — not invented for this slice. A metric the system does not
 * really collect is left out rather than declared and left to silently
 * return nothing forever.
 *
 * Every measurement a metric produces is dated and scaled
 * (measurement-scales.ts, `scaleVersion`): `compareMeasurements` refuses to
 * compare two numbers that used a different window, a different scale
 * version or a different segment, so a report can never quietly compare two
 * different rulers.
 *
 * Used by B1 (`validateFalsifier` gates a claim's falsifier before it can
 * become a Brain insight) and B5 (`measureMetric` is what the daily grader
 * calls to test a stored falsifier once its window closes).
 */
import { median } from "./interest";
import { BASELINE_DAYS } from "./measurement-scales";

const DAY_MS = 86_400_000;
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * `active_ads` (a live count of ads currently running) is NOT in this
 * registry. The schema's `metric` column documents it as a possible value,
 * but no code path writes it: `adPressureSignals` (interest.ts) writes only
 * `ad_days_running`, and `platina_interest_signals` has no run/batch id that
 * would let a reader tell "the ads present in the most recent collection"
 * apart from older rows for ads that may since have stopped. Counting
 * "active" ads would mean inferring an end state the platform never
 * reported — exactly what "not measured" exists to avoid. If a reader for
 * it is ever added (e.g. a `collected_at`-scoped "most recent run" column),
 * this is where it would be declared.
 */
export const FALSIFIER_METRIC_IDS = [
  "engagement_index",
  "topic_momentum",
  "ad_days_running",
  "event_participants",
  "creative_engagement_rate",
  "creative_ctr",
  "creative_leads",
] as const;
export type FalsifierMetricId = (typeof FALSIFIER_METRIC_IDS)[number];

export type Plane = "A" | "B";
export type Aggregation = "median" | "ratio_of_medians" | "sum" | "count" | "latest";

/**
 * The segment a measurement is taken on. Keys are generic across metrics;
 * which ones a given metric requires is `FalsifierMetricDef.segment`.
 * `brand`/`topic` match B1's falsifier `subject` shape (model-written
 * claims only ever name a brand or a topic); `creativeId`/`eventId` are
 * internal keys for the two metrics whose segment is a specific row
 * (a creative, an event) rather than a brand/topic pair.
 */
export type MetricSegment = {
  brand?: string;
  topic?: string;
  creativeId?: string;
  eventId?: string;
};

export type FalsifierMetricDef = {
  id: FalsifierMetricId;
  /** Plain operator words, no internal jargon. */
  label: string;
  /** A (first-party) or B (public/pattern layer) — never cited together. */
  plane: Plane;
  /** The table a measurement for this metric is read from. */
  table: string;
  /** Segment keys a subject must supply for this metric to be measurable. */
  segment: (keyof MetricSegment)[];
  aggregation: Aggregation;
  /** Allowed window_days. Both 30 and 90 unless one is meaningless (see comments below). */
  windows: readonly number[];
  minN: number;
  unit: string;
  scaleVersion: number;
};

export const FALSIFIER_METRICS: Record<FalsifierMetricId, FalsifierMetricDef> = {
  engagement_index: {
    id: "engagement_index",
    label: "engagement index (this company's posts vs. its own typical post)",
    plane: "B",
    table: "platina_interest_signals",
    segment: ["brand", "topic"],
    // interest.ts topicMomentum() reads a plain median over either window;
    // both are meaningful single-window reads of the same per-post ratio.
    aggregation: "median",
    windows: [30, 90],
    minN: 5, // interest.ts MIN_INTEREST_N
    unit: "x (1.0 = that company's own median post)",
    scaleVersion: 1,
  },
  topic_momentum: {
    id: "topic_momentum",
    label: "topic momentum (recent engagement index vs. the period before)",
    plane: "B",
    table: "platina_interest_signals",
    // Market-wide: interest.ts topicMomentum() is not scoped to one brand.
    segment: ["topic"],
    aggregation: "ratio_of_medians",
    // Only 30 is offered: interest.ts always measures the "recent" leg
    // against a fixed BASELINE_DAYS (90) window immediately before it
    // (measurement-scales.ts). A window_days of 90 would have to mean
    // "the 90 days before the 90 days before", which interest.ts does not
    // compute — so 90 is left out rather than silently reinterpreted.
    windows: [30],
    minN: 5, // interest.ts MIN_INTEREST_N (counts recent + baseline rows)
    unit: "ratio (recent median / prior-period median)",
    scaleVersion: 1,
  },
  ad_days_running: {
    id: "ad_days_running",
    label: "days a competitor's ad has run (per advertiser)",
    plane: "B",
    table: "platina_interest_signals",
    segment: ["brand", "topic"],
    // A plain median of the stored day-counts within the window — the same
    // single-window read topicMomentum() does for pressure signals.
    aggregation: "median",
    windows: [30, 90],
    minN: 5,
    unit: "days",
    scaleVersion: 1,
  },
  event_participants: {
    id: "event_participants",
    label: "competitors confirmed attending this event",
    plane: "B",
    table: "platina_event_participants",
    segment: ["eventId"],
    // One row per proof (market-insights.ts eventInsights already states
    // these by name, not as a sampled trend) — a count, not a median.
    aggregation: "count",
    windows: [30, 90],
    // One proof is already a reportable fact; there is no sampling noise to
    // gate against (unlike a trend built from many posts).
    minN: 1,
    unit: "companies",
    scaleVersion: 1,
  },
  creative_engagement_rate: {
    id: "creative_engagement_rate",
    label: "engagement rate on this creative (most recent capture)",
    plane: "A",
    table: "platina_creative_metrics",
    segment: ["creativeId"],
    // review.ts reads only the latest captured snapshot, not an average
    // across snapshots (a creative's numbers accumulate over its life).
    aggregation: "latest",
    windows: [30, 90],
    minN: 1,
    unit: "engagements / impression",
    scaleVersion: 1,
  },
  creative_ctr: {
    id: "creative_ctr",
    label: "click-through rate on this creative (most recent capture)",
    plane: "A",
    table: "platina_creative_metrics",
    segment: ["creativeId"],
    aggregation: "latest",
    windows: [30, 90],
    minN: 1,
    unit: "clicks / impression",
    scaleVersion: 1,
  },
  creative_leads: {
    id: "creative_leads",
    label: "leads from this creative (most recent capture)",
    plane: "A",
    table: "platina_creative_metrics",
    segment: ["creativeId"],
    // Leads are a running count per capture, like impressions — the latest
    // capture is the total so far, same as review.ts's `facts.leads`.
    aggregation: "latest",
    windows: [30, 90],
    minN: 1,
    unit: "leads",
    scaleVersion: 1,
  },
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** One raw reading behind a measurement. Never a fabricated 0 for a missing one. */
export type Observation = {
  value: number;
  observedAt: Date;
};

export type MetricResult =
  | { status: "measured"; value: number; n: number }
  | { status: "insufficient"; n: number }
  | { status: "not_measured" };

function ageDays(o: Observation, now: Date): number {
  return (now.getTime() - o.observedAt.getTime()) / DAY_MS;
}

/** `age` in `[0, maxDays]` — matches interest.ts topicMomentum's recent window. */
function isWithin(o: Observation, now: Date, maxDays: number): boolean {
  const age = ageDays(o, now);
  return age >= 0 && age <= maxDays;
}

/** `age` in `(minDays, maxDays]` — matches interest.ts topicMomentum's baseline window. */
function isBetween(o: Observation, now: Date, minDays: number, maxDays: number): boolean {
  const age = ageDays(o, now);
  return age > minDays && age <= maxDays;
}

/**
 * Pure aggregation over already-collected observations. An empty
 * observations array means the platform reported nothing for this segment
 * at all — `not_measured`, never a 0. A non-empty array with fewer than
 * `def.minN` readings inside `window` is `insufficient`. Otherwise the
 * metric's declared aggregation is applied and `measured` is returned.
 */
export function aggregateMetric(
  def: FalsifierMetricDef,
  observations: Observation[],
  window: number,
  now: Date,
): MetricResult {
  if (observations.length === 0) return { status: "not_measured" };

  switch (def.aggregation) {
    case "median": {
      const rows = observations.filter((o) => isWithin(o, now, window));
      if (rows.length < def.minN) return { status: "insufficient", n: rows.length };
      const value = median(rows.map((r) => r.value));
      return value === null ? { status: "insufficient", n: rows.length } : { status: "measured", value: round2(value), n: rows.length };
    }
    case "sum": {
      const rows = observations.filter((o) => isWithin(o, now, window));
      if (rows.length < def.minN) return { status: "insufficient", n: rows.length };
      return { status: "measured", value: round2(rows.reduce((total, r) => total + r.value, 0)), n: rows.length };
    }
    case "count": {
      const rows = observations.filter((o) => isWithin(o, now, window));
      if (rows.length < def.minN) return { status: "insufficient", n: rows.length };
      return { status: "measured", value: rows.length, n: rows.length };
    }
    case "latest": {
      const rows = observations.filter((o) => isWithin(o, now, window));
      if (rows.length < def.minN) return { status: "insufficient", n: rows.length };
      const latest = rows.reduce((best, r) => (r.observedAt.getTime() > best.observedAt.getTime() ? r : best));
      return { status: "measured", value: round2(latest.value), n: rows.length };
    }
    case "ratio_of_medians": {
      const recentRows = observations.filter((o) => isWithin(o, now, window));
      const baselineRows = observations.filter((o) => isBetween(o, now, window, window + BASELINE_DAYS));
      const n = recentRows.length + baselineRows.length;
      if (n < def.minN) return { status: "insufficient", n };
      const recentMedian = median(recentRows.map((r) => r.value));
      const baselineMedian = median(baselineRows.map((r) => r.value));
      // Both legs are needed for a ratio; a missing or zero baseline can
      // never be fabricated into a number.
      if (recentMedian === null || baselineMedian === null || baselineMedian === 0) {
        return { status: "insufficient", n };
      }
      return { status: "measured", value: round2(recentMedian / baselineMedian), n };
    }
    default: {
      // Exhaustive over Aggregation (5 members, all handled above); this
      // line only type-checks if `def.aggregation` is `never` here.
      const unreachable: never = def.aggregation;
      throw new Error(`unknown aggregation "${unreachable}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Measuring through injected deps
// ---------------------------------------------------------------------------

/**
 * One reader per metric, returning the raw observations for a workspace +
 * segment over `[from, now]` (and, for a ratio metric, the baseline leg
 * before `from` too — `measureMetric` asks for however far back the
 * aggregation needs). Implemented for real in falsifier-metrics-deps.ts.
 */
export type MeasureDeps = {
  [K in FalsifierMetricId]: (
    workspaceId: string,
    segment: MetricSegment,
    from: Date,
    now: Date,
  ) => Promise<Observation[]>;
};

function missingSegmentKeys(def: FalsifierMetricDef, segment: MetricSegment): (keyof MetricSegment)[] {
  return def.segment.filter((key) => !segment[key]);
}

/**
 * Validates metric id, window and segment, reads through `deps` (asking for
 * enough lookback to cover the aggregation — a ratio metric needs its
 * baseline leg too) and aggregates. Throws on a request the registry cannot
 * even attempt to answer (unknown metric/window/segment) rather than
 * returning a status for a question that was never well-formed.
 */
export async function measureMetric(
  deps: MeasureDeps,
  workspaceId: string,
  metricId: FalsifierMetricId,
  segment: MetricSegment,
  windowDays: number,
  now: Date,
): Promise<MetricResult> {
  const def = FALSIFIER_METRICS[metricId];
  if (!def) throw new Error(`"${metricId}" is not a metric this system measures`);
  if (!def.windows.includes(windowDays)) {
    throw new Error(`${def.label} is only measured over ${def.windows.join(" or ")} days, not ${windowDays}`);
  }
  const missing = missingSegmentKeys(def, segment);
  if (missing.length > 0) {
    throw new Error(`${def.label} needs a ${missing.join(" and ")} to be measured against`);
  }
  const lookbackDays = def.aggregation === "ratio_of_medians" ? windowDays + BASELINE_DAYS : windowDays;
  const from = new Date(now.getTime() - lookbackDays * DAY_MS);
  const observations = await deps[metricId](workspaceId, segment, from, now);
  return aggregateMetric(def, observations, windowDays, now);
}

// ---------------------------------------------------------------------------
// Comparing measurements across scales
// ---------------------------------------------------------------------------

export type Measurement = {
  metric: FalsifierMetricId;
  scaleVersion: number;
  windowDays: number;
  segment: MetricSegment;
  value: number;
  n: number;
};

/** Thrown by compareMeasurements: the two numbers used different rulers and cannot be compared. */
export class ScaleMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaleMismatchError";
  }
}

const SEGMENT_KEYS: (keyof MetricSegment)[] = ["brand", "topic", "creativeId", "eventId"];

function segmentsEqual(a: MetricSegment, b: MetricSegment): boolean {
  return SEGMENT_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

/**
 * `delta` and `ratio` between two measurements of the SAME metric, scale
 * version, window and segment. Any mismatch throws `ScaleMismatchError`
 * instead of returning a number a cross-scale comparison would fabricate.
 */
export function compareMeasurements(a: Measurement, b: Measurement): { delta: number; ratio: number | null } {
  if (a.metric !== b.metric) {
    throw new ScaleMismatchError(`cannot compare "${a.metric}" with "${b.metric}" — different metrics`);
  }
  if (a.scaleVersion !== b.scaleVersion) {
    throw new ScaleMismatchError(`cannot compare ${a.metric} at scale v${a.scaleVersion} with v${b.scaleVersion}`);
  }
  if (a.windowDays !== b.windowDays) {
    throw new ScaleMismatchError(`cannot compare ${a.metric} over ${a.windowDays} days with ${b.windowDays} days`);
  }
  if (!segmentsEqual(a.segment, b.segment)) {
    throw new ScaleMismatchError(`cannot compare ${a.metric} across different segments`);
  }
  return { delta: round2(b.value - a.value), ratio: a.value !== 0 ? round2(b.value / a.value) : null };
}

// ---------------------------------------------------------------------------
// Validating a falsifier before it can become a claim
// ---------------------------------------------------------------------------

/** The shape B1's interrogation schema writes for a claim's falsifier. */
export type FalsifierClaim = {
  metric: string;
  subject: MetricSegment;
  direction: "above" | "below";
  threshold: number;
  window_days: number;
};

export type ValidateFalsifierOptions = {
  /**
   * Returns whether `value` is a real brand/topic/etc. in this workspace.
   * Omitted in pure/offline use (this registry has no DB access); B1
   * injects a workspace-aware check when it validates a live claim.
   */
  resolvesSubjectKey?: (key: keyof MetricSegment, value: string) => boolean;
};

/**
 * Whether a falsifier names a metric this system can actually test, over a
 * window that metric declares, on a subject with the segment that metric
 * needs. Rejection reasons are plain operator words: shown as "the claim
 * could not be tested: …".
 */
export function validateFalsifier(
  f: FalsifierClaim,
  opts?: ValidateFalsifierOptions,
): { ok: true } | { ok: false; reason: string } {
  const def = FALSIFIER_METRICS[f.metric as FalsifierMetricId];
  if (!def) return { ok: false, reason: `"${f.metric}" is not a metric this system measures` };

  if (!def.windows.includes(f.window_days)) {
    return {
      ok: false,
      reason: `${def.label} is only measured over ${def.windows.join(" or ")} days, not ${f.window_days}`,
    };
  }
  if (f.direction !== "above" && f.direction !== "below") {
    return { ok: false, reason: `direction must be "above" or "below"` };
  }
  if (!Number.isFinite(f.threshold)) {
    return { ok: false, reason: "threshold must be a number" };
  }

  const missing = missingSegmentKeys(def, f.subject);
  if (missing.length > 0) {
    return { ok: false, reason: `${def.label} needs a ${missing.join(" and ")} to be measured against` };
  }

  if (opts?.resolvesSubjectKey) {
    const unresolved = def.segment.filter((key) => !opts.resolvesSubjectKey!(key, f.subject[key]!));
    if (unresolved.length > 0) {
      return { ok: false, reason: `the ${unresolved.join(", ")} named in this claim is not in this workspace` };
    }
  }

  return { ok: true };
}
