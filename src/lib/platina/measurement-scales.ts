/**
 * Scale constants (Metacognitive Brain plan, B0 — "coastline" rule).
 *
 * A measured value depends on the ruler held against it: "momentum" over 30
 * days and "momentum" over 90 days are two different, non-comparable
 * measurements, not one number read twice. So every window and sample-size
 * floor the system uses is declared once, here, instead of as a constant
 * copied into whichever file happens to need it — and it is versioned
 * (falsifier-metrics.ts `scaleVersion`), so a later change to one of these
 * numbers bumps the version rather than silently reinterpreting old
 * measurements as if they used the new ruler.
 *
 * Moved out of interest.ts (C3) without changing a value: interest.ts
 * re-exports these same names, so every existing importer keeps working.
 */

/** Below this many data points, "insufficient signal" — never a score. */
export const MIN_INTEREST_N = 5;
/** "Now" vs. "before" windows for momentum. */
export const RECENT_DAYS = 30;
export const BASELINE_DAYS = 90;
