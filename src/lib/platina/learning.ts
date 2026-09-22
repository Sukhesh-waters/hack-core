/**
 * The learning engine (C6 L5, owner decision 2026-09-22). Pure.
 *
 * A feedback loop plus bandit re-weighting over the workspace's own recorded
 * results — not deep RL (a client posts tens of pieces a month, not
 * thousands). Only CONFIRMED reviews count: the system never learns from its
 * own unreviewed guesses.
 *
 *  - Each confirmed result credits its features (topic, channel, format,
 *    hook, weekday, the opportunity it answered): worked = 1, mixed = 0.5,
 *    failed = 0.
 *  - Per feature value a Beta posterior, with older results fading
 *    (half-life), so the loop keeps up with the market.
 *  - Min-N gate: a value with fewer results than the workspace minimum has
 *    NO effect and says "not enough results yet".
 *  - Ranking draws one Thompson sample per value from a generator seeded by
 *    workspace + day: the order is stable within a day and never a fixed
 *    point, so a lucky early result cannot lock the ranking.
 *  - A fixed explore share: one slot per block is given to an untested item,
 *    labelled "trying something new" so nobody mistakes it for evidence.
 */
import type { ReviewVerdict } from "@/db/platina-schema";

export const LEARNING_FEATURES = ["topic", "channel", "format", "hook", "weekday", "opportunity"] as const;
export type LearningFeature = (typeof LEARNING_FEATURES)[number];
export type FeatureValues = Partial<Record<LearningFeature, string | null | undefined>>;

export const FEATURE_LABEL: Record<LearningFeature, string> = {
  topic: "Topic",
  channel: "Channel",
  format: "Format",
  hook: "Hook",
  weekday: "Posting day",
  opportunity: "Opportunity",
};

export type LearnedResult = {
  creativeId: string;
  verdict: ReviewVerdict;
  confirmedAt: Date;
  features: FeatureValues;
};

export type FeatureStat = {
  feature: LearningFeature;
  value: string;
  /** Confirmed results behind it (raw count, before fading). */
  n: number;
  worked: number;
  mixed: number;
  failed: number;
  alpha: number;
  beta: number;
  /** Posterior mean chance of beating the usual post. */
  mean: number;
  low: number;
  high: number;
  status: "ok" | "insufficient";
};

export const REWARD: Record<ReviewVerdict, number> = { worked: 1, mixed: 0.5, failed: 0 };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Normalised feature value: case and spacing never split one value in two. */
export function normaliseValue(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return v ? v : null;
}

export function weekdayOf(date: Date | null | undefined): string | null {
  return date ? WEEKDAYS[date.getUTCDay()].toLowerCase() : null;
}

/** Weight of a result `ageDays` old with the given half-life. */
export function decayWeight(ageDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1;
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

export function featureStats(
  results: LearnedResult[],
  options: { now: Date; halfLifeDays: number; minN: number },
): FeatureStat[] {
  const acc = new Map<string, FeatureStat>();
  for (const r of results) {
    const reward = REWARD[r.verdict];
    const w = decayWeight((options.now.getTime() - r.confirmedAt.getTime()) / 86_400_000, options.halfLifeDays);
    for (const feature of LEARNING_FEATURES) {
      const value = normaliseValue(r.features[feature]);
      if (!value) continue;
      const key = `${feature}\u0000${value}`;
      let s = acc.get(key);
      if (!s) {
        s = { feature, value, n: 0, worked: 0, mixed: 0, failed: 0, alpha: 1, beta: 1, mean: 0.5, low: 0, high: 1, status: "insufficient" };
        acc.set(key, s);
      }
      s.n += 1;
      s[r.verdict] += 1;
      s.alpha += w * reward;
      s.beta += w * (1 - reward);
    }
  }
  const out = [...acc.values()];
  for (const s of out) {
    const total = s.alpha + s.beta;
    s.mean = s.alpha / total;
    const sd = Math.sqrt((s.alpha * s.beta) / (total * total * (total + 1)));
    s.low = Math.max(0, s.mean - 1.28 * sd);
    s.high = Math.min(1, s.mean + 1.28 * sd);
    s.status = s.n >= options.minN ? "ok" : "insufficient";
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature) || b.n - a.n || a.value.localeCompare(b.value));
}

/** Plain words for one stat. Below min-N it never gives a direction. */
export function describeStat(stat: FeatureStat, minN: number): string {
  const label = `${FEATURE_LABEL[stat.feature]} "${stat.value}"`;
  if (stat.status !== "ok") {
    return `${label}: ${stat.n} result${stat.n === 1 ? "" : "s"} so far, needs ${minN} before it changes anything`;
  }
  const lean = stat.low > 0.5 ? "tends to beat" : stat.high < 0.5 ? "tends to trail" : "is level with";
  return `${label} ${lean} your usual post (worked ${stat.worked}, mixed ${stat.mixed}, failed ${stat.failed} of ${stat.n})`;
}

// ---------------------------------------------------------------------------
// Seeded sampling
// ---------------------------------------------------------------------------

/** Deterministic generator (mulberry32) from a string seed. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Gamma(shape, 1) by Marsaglia-Tsang (boosted for shape < 1). */
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(rng() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = gamma(alpha, rng);
  const y = gamma(beta, rng);
  return x / (x + y);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type LearnedRank<T> = {
  item: T;
  /** Position before learning (the stated rules' order). */
  baseIndex: number;
  /** The stats that moved it; empty = no result passes the min-N gate yet. */
  basis: FeatureStat[];
  /** Given a slot to try something new. */
  explore: boolean;
  movement: "up" | "down" | "none";
};

/**
 * How far results can move an item: a sample of 0.9 (a clear winner) adds
 * 0.6 to a rule score in [0, 1], about half the list. The stated rules still
 * decide among items the results say nothing about.
 */
export const LEARNING_WEIGHT = 1.5;

/**
 * Re-orders items (already in rule order) by what the workspace's own
 * results say. score = rule position in [0, 1] + (Thompson sample - 0.5) x
 * LEARNING_WEIGHT. Items with no stat past the min-N gate get no adjustment,
 * so below the gate nothing moves.
 */
export function rankWithLearning<T>(
  items: T[],
  options: {
    featuresOf: (item: T) => FeatureValues;
    stats: FeatureStat[];
    seed: string;
    exploreShare: number;
  },
): LearnedRank<T>[] {
  const rng = seededRandom(options.seed);
  const ok = new Map(
    options.stats.filter((s) => s.status === "ok").map((s) => [`${s.feature}\u0000${s.value}`, s]),
  );
  const count = items.length;
  const scored = items.map((item, baseIndex) => {
    const features = options.featuresOf(item);
    const basis: FeatureStat[] = [];
    for (const feature of LEARNING_FEATURES) {
      const value = normaliseValue(features[feature]);
      const stat = value ? ok.get(`${feature}\u0000${value}`) : undefined;
      if (stat) basis.push(stat);
    }
    const theta =
      basis.length > 0 ? basis.reduce((sum, s) => sum + sampleBeta(s.alpha, s.beta, rng), 0) / basis.length : 0.5;
    const rulePart = count > 1 ? 1 - baseIndex / (count - 1) : 1;
    return { item, baseIndex, basis, explore: false, score: rulePart + (theta - 0.5) * LEARNING_WEIGHT };
  });
  const ordered = [...scored].sort((a, b) => b.score - a.score || a.baseIndex - b.baseIndex);

  // Explore: in every block of `every` positions, at least one untested item.
  if (options.exploreShare > 0 && ordered.length >= 3) {
    const every = Math.max(2, Math.round(1 / options.exploreShare));
    for (let start = 0; start < ordered.length; start += every) {
      const end = Math.min(start + every, ordered.length);
      const block = ordered.slice(start, end);
      if (block.some((r) => r.basis.length === 0)) continue;
      const laterIndex = ordered.findIndex((r, i) => i >= end && r.basis.length === 0);
      if (laterIndex < 0) break;
      const [moved] = ordered.splice(laterIndex, 1);
      moved.explore = true;
      ordered.splice(end - 1, 0, moved);
    }
  }

  return ordered.map((r, index) => ({
    item: r.item,
    baseIndex: r.baseIndex,
    basis: r.basis,
    explore: r.explore,
    movement: index < r.baseIndex ? "up" : index > r.baseIndex ? "down" : "none",
  }));
}

/** Seed for today's sampling: stable within a UTC day for one workspace. */
export function learningSeed(workspaceId: string, now: Date, salt = ""): string {
  return `${workspaceId}:${now.toISOString().slice(0, 10)}:${salt}`;
}
