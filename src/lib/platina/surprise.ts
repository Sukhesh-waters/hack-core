/**
 * Surprise filter (Metacognitive Brain plan B4, "statistic rung"). Pure.
 *
 * Prevents the two-call debate from running on every non-boilerplate change:
 * a busy page's *usual* change can be large (a newsroom) or a repeating
 * rotation (a "latest posts" widget). Magnitude alone cannot tell those
 * apart, so this tracks novelty (word-level, via consolidate.ts) against a
 * Welford running expectation per key, and only lets a document through when
 * it deviates from what THIS key's history says is usual — or when a rule
 * override (first sighting, a date, a price) always lets it through
 * regardless of the statistic. A 10% audit sample keeps the filter's
 * false-negative rate measured even once it is live (CLAUDE.md: a number the
 * platform did not report is "not measured", never synthesised — the audit
 * sample is how "would this have been missed?" gets an honest answer instead
 * of an assumed one).
 *
 * The caller MUST persist `next` after every call, surprising or not — an
 * expectation that only updates on "analyse" decisions would be a biased
 * sample of the quiet days, not a true running mean.
 */
import { words, similarity } from "./consolidate";
import { findDateRanges } from "./events";
import { deterministicShare } from "./brain-modes";
import { MIN_INTEREST_N } from "./measurement-scales";

// ---------------------------------------------------------------------------
// Welford running mean/variance
// ---------------------------------------------------------------------------

export type Expectation = { n: number; mean: number; m2: number };

/** One more observation folded in. `e === null` starts a fresh expectation. */
export function updateExpectation(e: Expectation | null, x: number): Expectation {
  const prev = e ?? { n: 0, mean: 0, m2: 0 };
  const n = prev.n + 1;
  const delta = x - prev.mean;
  const mean = prev.mean + delta / n;
  const m2 = prev.m2 + delta * (x - mean);
  return { n, mean, m2 };
}

/** Sample standard deviation (n−1). 0 for fewer than 2 observations — not NaN. */
export function sd(e: Expectation): number {
  return e.n < 2 ? 0 : Math.sqrt(e.m2 / (e.n - 1));
}

// ---------------------------------------------------------------------------
// Novelty — the tracked value for web/press/trade pages
// ---------------------------------------------------------------------------

/**
 * 1 − the highest word-level Jaccard similarity between `addedText` and any
 * of `previousTexts`: 1 means wholly new words, 0 means the same words as
 * something already seen. No previous version → 1 (nothing to compare
 * against, so it cannot be called familiar). Reuses consolidate.ts's
 * `words()`/`similarity()` — the same Jaccard the monthly consolidation job
 * uses to decide two Brain insights repeat each other.
 */
export function novelty(addedText: string, previousTexts: string[]): number {
  if (previousTexts.length === 0) return 1;
  const addedWords = words(addedText);
  let maxSim = 0;
  for (const prev of previousTexts) {
    const sim = similarity(addedWords, words(prev));
    if (sim > maxSim) maxSim = sim;
  }
  return 1 - maxSim;
}

// ---------------------------------------------------------------------------
// Expectation keys — one running distribution per (source kind, subject)
// ---------------------------------------------------------------------------

/**
 * Per-source-kind expectation keys (brief §5 B4 table). `ads` tracks
 * `ad_days_running` (median days an advertiser's ads have run) — NOT
 * `active_ads`, which falsifier-metrics.ts documents as never collected.
 */
export const expectationKey = {
  novelty: (canonicalUrl: string): string => `nov:${canonicalUrl}`,
  engagement: (brandId: string): string => `eng:${brandId}`,
  ads: (brandId: string): string => `ads:${brandId}`,
} as const;

// ---------------------------------------------------------------------------
// Rule-rung override: a date or a price always proceeds
// ---------------------------------------------------------------------------

/** Mirrors signal-value.ts's inline price check (`/[$€£]\s?\d/`); not exported there, so reproduced here rather than reached into a private detail. */
const PRICE_PATTERN = /[$€£]\s?\d/;

/**
 * True when `text` names a date (reuses events.ts `findDateRanges`, the
 * page's own date-detection — a model's guess is never trusted, only words
 * actually on the page) or a price. Either is enough to always analyse a
 * change: a diff that adds "26-28 October 2026" or "$499/month" is news
 * regardless of how novel its wording is. `findDateRanges` is called with no
 * reference date, so year-less mentions ("September 22–23") are not caught
 * here — only dates that state their own year, which is the common case for
 * an announcement worth overriding on.
 */
export function hasDateOrPrice(text: string): boolean {
  return findDateRanges(text).length > 0 || PRICE_PATTERN.test(text);
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type SurpriseInput = {
  /** This key's expectation BEFORE this observation (null = never observed). */
  expectation: Expectation | null;
  observed: number;
  /** Standard deviations from the mean before a document earns a second look. Default 1.0 (owner decision D2). */
  floor?: number;
  /** Minimum sd, so a near-zero-variance key does not divide by ~0 (e.g. 0.05 for novelty, which is bounded in [0,1]). */
  floorSd: number;
  /** Below this many prior observations nothing has a real distribution yet. Default MIN_INTEREST_N (5). */
  minN?: number;
  /** The first time this key has ever been observed — always proceeds. */
  firstSeen?: boolean;
  /** `hasDateOrPrice(text)` on the change — always proceeds. */
  hasDateOrPrice?: boolean;
  /** Share of would-skip documents analysed anyway. Default 0.1 (owner decision D2). */
  auditShare?: number;
  /** Id the audit sample is drawn deterministically from (the signal document id). */
  docId: string;
};

export type SurpriseDecision = {
  action: "analyse" | "skip" | "audit";
  /** Plain operator words (matches the §9 copy glossary) — never "surprise", "predictive" or "falsifier". */
  reason: string;
  /** |observed − mean| / max(sd, floorSd) against the PRIOR expectation. null when no statistic was computed (cold start or a rule override). */
  deviation: number | null;
  /** The expectation updated with this observation. The caller must persist this every time, analysed or not. */
  next: Expectation;
};

/**
 * Whether a changed document is surprising enough, against ITS OWN key's
 * history, to spend a model call on. See the module doc comment for why
 * novelty (not magnitude) is the tracked value, and why `next` must always
 * be persisted.
 */
export function decideSurprise(input: SurpriseInput): SurpriseDecision {
  const {
    expectation,
    observed,
    floor = 1.0,
    floorSd,
    minN = MIN_INTEREST_N,
    firstSeen = false,
    hasDateOrPrice: datedOrPriced = false,
    auditShare = 0.1,
    docId,
  } = input;

  const next = updateExpectation(expectation, observed);

  if (firstSeen) {
    return { action: "analyse", reason: "the first time this page has been seen", deviation: null, next };
  }
  if (datedOrPriced) {
    return { action: "analyse", reason: "the change names a date or a price", deviation: null, next };
  }
  if (!expectation || expectation.n < minN) {
    return { action: "analyse", reason: "not enough history yet to know what is usual here", deviation: null, next };
  }

  const spread = Math.max(sd(expectation), floorSd);
  const deviation = Math.abs(observed - expectation.mean) / spread;

  if (deviation >= floor) {
    return { action: "analyse", reason: "bigger than this page's usual change", deviation, next };
  }
  if (deterministicShare(docId, auditShare, "surprise-audit")) {
    return { action: "audit", reason: "checked anyway (spot check)", deviation, next };
  }
  return { action: "skip", reason: "nothing unusual compared with this page's normal changes", deviation, next };
}
