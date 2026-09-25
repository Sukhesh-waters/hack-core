/**
 * Every collection spend number, in one place (core spine R7). Pure.
 *
 * Round 3 set three caps independently and they did not compose: the
 * workspace's daily cap (40 pages) was LOWER than one source's own daily cap
 * (48) and lower than two targets at full depth (50), while the analysis cap
 * (100/day) could never be reached because collection could not produce that
 * many documents in a day. A realistic first pass — one client plus four
 * competitors at 25 pages — wants 125 pages and got 40, so the product's
 * first impression took three days.
 *
 * The fix is not a bigger number. It is two budgets with different jobs:
 *
 *   FIRST PASS  a one-time, per-client allowance that builds the first
 *               picture in one sitting. Charged once per client, ever.
 *   STEADY      the daily cap that keeps that picture current.
 *
 * The relationships between them are asserted in budget.test.ts, so a future
 * edit that breaks composition fails a test instead of quietly starving the
 * pipeline.
 */

/** Pages one source may collect per UTC day. */
export const PAGES_PER_SOURCE_DAY = 48;
/** Pages a workspace may collect per UTC day once the first pass is done. */
export const DEFAULT_WORKSPACE_DAY_CAP = 40;
/** One-time pages per client, to build the first picture without waiting days. */
export const DEFAULT_FIRST_PASS_PAGES = 150;
/** Hard ceiling per crawl target (mirrors actors.ts MAX_PAGES_CEILING). */
export const MAX_PAGES_PER_TARGET = 25;

export type BudgetInput = {
  /** Pages this source may still spend today under its own cap. */
  specRemaining: number;
  /** Pages the workspace may still spend today under the daily cap. */
  workspaceRemaining: number;
  /** Pages left in this client's one-time first-pass allowance. */
  firstPassRemaining: number;
  /**
   * Pages an operator granted to this one run (C8.0 force run), recorded on
   * the run's config snapshot. Bypasses the workspace daily cap, never the
   * source's own cap. Absent or 0 on every scheduled run.
   */
  seedPages?: number;
};

export type BudgetDecision = {
  /** Pages this run may collect. Zero means "do not run". */
  pages: number;
  /** Which purse pays. The first pass does not touch the daily cap. */
  charge: "first_pass" | "seed" | "daily";
  /** Plain language for the run timeline and the UI. */
  reason: string;
};

export const DAILY_CAP_REASON = "daily collection cap reached";
export const SOURCE_CAP_REASON = "daily page limit for this source reached";

/**
 * How many pages one run may collect, and which budget pays for it.
 *
 * The first-pass allowance is spent first and deliberately bypasses the daily
 * cap: a new client is meant to be readable the same afternoon. Once it is
 * used up the client falls back to the steady daily cap forever.
 */
export function budgetForRun(input: BudgetInput): BudgetDecision {
  const specRemaining = Math.max(0, input.specRemaining);
  if (specRemaining === 0) {
    return { pages: 0, charge: "daily", reason: SOURCE_CAP_REASON };
  }

  const firstPass = Math.max(0, input.firstPassRemaining);
  if (firstPass > 0) {
    return {
      pages: Math.min(specRemaining, firstPass),
      charge: "first_pass",
      reason: "first pass for this client",
    };
  }

  const seed = Math.max(0, input.seedPages ?? 0);
  if (seed > 0) {
    return {
      pages: Math.min(specRemaining, seed),
      charge: "seed",
      reason: "operator seed run",
    };
  }

  const workspaceRemaining = Math.max(0, input.workspaceRemaining);
  if (workspaceRemaining === 0) {
    return { pages: 0, charge: "daily", reason: DAILY_CAP_REASON };
  }
  return {
    pages: Math.min(specRemaining, workspaceRemaining),
    charge: "daily",
    reason: "within the daily limit",
  };
}

/** Pages left in a client's one-time allowance. */
export function firstPassRemaining(
  used: number | null | undefined,
  allowance: number = DEFAULT_FIRST_PASS_PAGES,
): number {
  return Math.max(0, allowance - Math.max(0, used ?? 0));
}

/** What the operator is told before approving a client's sources. */
export function describeBudget(
  firstPassLeft: number,
  dailyCap: number,
): string {
  return firstPassLeft > 0
    ? `We'll read up to ${firstPassLeft} pages for this client to build the first picture, then about ${dailyCap} a day to keep it current.`
    : `We'll read up to ${dailyCap} pages a day for this workspace to keep what we know current.`;
}
