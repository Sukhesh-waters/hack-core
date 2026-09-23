/**
 * Real account usage, read from the providers themselves (C7.1): the ops
 * board shows what Apify and Firecrawl will bill, not our own estimate.
 * Read-only calls; a failure becomes an amber "couldn't read" line.
 */
import type { SpendReading } from "./checks";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Apify: this month's usage in USD against the account's monthly cap. */
export async function readApifyUsage(token: string | undefined, fetchImpl: Fetch = fetch): Promise<SpendReading> {
  const name = "Apify";
  if (!token) return { name, error: "no APIFY_TOKEN" };
  try {
    const res = await fetchImpl("https://api.apify.com/v2/users/me/limits", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { name, error: `HTTP ${res.status}` };
    const json = (await res.json()) as {
      data?: {
        monthlyUsageCycle?: { startAt?: string; endAt?: string };
        limits?: { maxMonthlyUsageUsd?: number };
        current?: { monthlyUsageUsd?: number };
      };
    };
    const d = json.data;
    if (!d?.monthlyUsageCycle?.startAt || !d.monthlyUsageCycle.endAt || typeof d.current?.monthlyUsageUsd !== "number") {
      return { name, error: "unexpected answer" };
    }
    return {
      name,
      used: d.current.monthlyUsageUsd,
      cap: typeof d.limits?.maxMonthlyUsageUsd === "number" ? d.limits.maxMonthlyUsageUsd : null,
      unit: "usd",
      periodStart: new Date(d.monthlyUsageCycle.startAt),
      periodEnd: new Date(d.monthlyUsageCycle.endAt),
    };
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : "unreachable" };
  }
}

/** Firecrawl: credits spent this billing period (plan + remaining -> used). */
export async function readFirecrawlUsage(key: string | undefined, fetchImpl: Fetch = fetch): Promise<SpendReading> {
  const name = "Firecrawl";
  if (!key) return { name, error: "no FIRECRAWL_API_KEY" };
  try {
    const res = await fetchImpl("https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { name, error: `HTTP ${res.status}` };
    const json = (await res.json()) as {
      data?: { remainingCredits?: number; planCredits?: number; billingPeriodStart?: string; billingPeriodEnd?: string };
    };
    const d = json.data;
    if (typeof d?.remainingCredits !== "number" || typeof d.planCredits !== "number" || !d.billingPeriodStart || !d.billingPeriodEnd) {
      return { name, error: "unexpected answer" };
    }
    // Bonus credits can put `remaining` above the plan; spent is never negative.
    return {
      name,
      used: Math.max(0, d.planCredits - d.remainingCredits),
      cap: d.planCredits,
      remaining: d.remainingCredits,
      unit: "credits",
      periodStart: new Date(d.billingPeriodStart),
      periodEnd: new Date(d.billingPeriodEnd),
    };
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : "unreachable" };
  }
}
