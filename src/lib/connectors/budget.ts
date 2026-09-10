/**
 * Budget governance for Apify scraping costs.
 *
 * Two-layer model:
 * - Per-workspace daily soft cap (warning + require manual override)
 * - Per-org monthly hard ceiling (block all scraping)
 *
 * Pure helpers — no DB access. The Inngest plan step checks budgets
 * before dispatching actor runs.
 */

export type BudgetRecord = {
  workspaceId: string;
  orgId: string;
  /** Apify credits consumed today (workspace-level). */
  dailyCreditsUsed: number;
  /** Apify credits consumed this month (org-level). */
  monthlyCreditsUsed: number;
};

export type BudgetLimits = {
  /** Workspace daily soft cap (credits). Default: 50. */
  dailySoftCap?: number;
  /** Org monthly hard ceiling (credits). Default: 1000. */
  monthlyHardCeiling?: number;
};

const DEFAULT_DAILY_SOFT_CAP = 50;
const DEFAULT_MONTHLY_HARD_CEILING = 1000;

export type BudgetCheckResult = {
  allowed: boolean;
  reason: "ok" | "daily_soft_cap_exceeded" | "monthly_hard_ceiling_exceeded";
  dailyUsed: number;
  dailyCap: number;
  monthlyUsed: number;
  monthlyCap: number;
};

/**
 * Check whether a scraping run is within budget.
 *
 * Returns `allowed: false` only for the monthly hard ceiling.
 * Daily soft cap returns `allowed: true` with `reason: "daily_soft_cap_exceeded"`
 * so the caller can decide whether to warn or require manual override.
 */
export function checkBudget(
  record: BudgetRecord,
  limits?: BudgetLimits,
): BudgetCheckResult {
  const dailyCap = limits?.dailySoftCap ?? DEFAULT_DAILY_SOFT_CAP;
  const monthlyCap = limits?.monthlyHardCeiling ?? DEFAULT_MONTHLY_HARD_CEILING;

  if (record.monthlyCreditsUsed >= monthlyCap) {
    return {
      allowed: false,
      reason: "monthly_hard_ceiling_exceeded",
      dailyUsed: record.dailyCreditsUsed,
      dailyCap,
      monthlyUsed: record.monthlyCreditsUsed,
      monthlyCap,
    };
  }

  if (record.dailyCreditsUsed >= dailyCap) {
    return {
      allowed: true, // soft cap — warn but don't block
      reason: "daily_soft_cap_exceeded",
      dailyUsed: record.dailyCreditsUsed,
      dailyCap,
      monthlyUsed: record.monthlyCreditsUsed,
      monthlyCap,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    dailyUsed: record.dailyCreditsUsed,
    dailyCap,
    monthlyUsed: record.monthlyCreditsUsed,
    monthlyCap,
  };
}

/**
 * Estimate Apify credits for a scraping run based on actor type and result count.
 * Rough heuristic — actual costs depend on actor compute and run duration.
 */
export function estimateCredits(
  actorKey: string,
  resultCount: number,
): number {
  // Apify pricing: ~$0.25-$0.50 per 1000 results for most actors
  // Expressed in "credits" (1 credit = $0.01 equivalent)
  const perResultCredit: Record<string, number> = {
    posts: 0.03,
    reels: 0.03,
    profile: 0.05,
    comments: 0.02,
    deep_post: 0.05,
    tiktok_posts: 0.04,
    tiktok_profile: 0.05,
    ad_library: 0.04,
  };

  const rate = perResultCredit[actorKey] ?? 0.03;
  return Math.ceil(resultCount * rate);
}
