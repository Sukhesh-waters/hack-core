/**
 * Analysis throughput policy (core spine S4). Pure.
 *
 * Each signal costs ~2 model calls plus an embed, so analysis is capped per
 * workspace per UTC day. The cap bounds spend; the batch bounds how much one
 * sweep fans out. Raising either is an owner decision, not a tuning knob.
 */
export const DAILY_ANALYSIS_CAP = 100;
export const SWEEP_BATCH = 50;

/** A claim older than this belongs to a worker that died; it can be taken again. */
export const STALE_CLAIM_MINUTES = 10;

/**
 * Analysis pacing. Each debate is one Groq and one Gemini call, and the free
 * Gemini tier answers 429/503 when hit in a burst — so debates are limited
 * account-wide, not just per workspace.
 */
export const ANALYSIS_THROTTLE = { limit: 8, period: "1m" } as const;
export const ANALYSIS_GLOBAL_CONCURRENCY = 2;

/** How many unprocessed signals this sweep may dispatch right now. */
export function analysisBatchSize(
  analysedToday: number,
  cap = DAILY_ANALYSIS_CAP,
  batch = SWEEP_BATCH,
): number {
  return Math.max(0, Math.min(batch, cap - analysedToday));
}

/**
 * Inngest drops an event whose id it has seen in the last 24 hours. The id is
 * therefore bucketed by the stale-claim window: two dispatchers in the same
 * window collapse to one event, but a signal whose analysis FAILED can be
 * dispatched again once the window passes instead of being silently ignored
 * for a day. (The atomic claim, not this id, is what prevents double analysis.)
 */
export const analyzeEventId = (signalId: string, now: number = Date.now()) =>
  `analyze:${signalId}:${Math.floor(now / (STALE_CLAIM_MINUTES * 60_000))}`;
