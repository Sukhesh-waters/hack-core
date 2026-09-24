/**
 * This month's Apify usage, read from Apify itself (C8.3): the Scan now gate
 * compares a scan's projected cost with what the account has left, not with
 * our own estimate of it. Read-only; a failure returns null and the gate
 * then refuses a paid scan instead of guessing.
 */
const LIMITS_URL = "https://api.apify.com/v2/users/me/limits";

export type ApifyMonth = { usedUsd: number; capUsd: number | null; resetsOn: string };

export async function readApifyMonth(token: string | undefined = process.env.APIFY_TOKEN): Promise<ApifyMonth | null> {
  if (!token) return null;
  try {
    const res = await fetch(LIMITS_URL, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const d = ((await res.json()) as {
      data?: {
        monthlyUsageCycle?: { endAt?: string };
        limits?: { maxMonthlyUsageUsd?: number };
        current?: { monthlyUsageUsd?: number };
      };
    }).data;
    if (typeof d?.current?.monthlyUsageUsd !== "number" || !d.monthlyUsageCycle?.endAt) return null;
    return {
      usedUsd: d.current.monthlyUsageUsd,
      capUsd: typeof d.limits?.maxMonthlyUsageUsd === "number" ? d.limits.maxMonthlyUsageUsd : null,
      resetsOn: d.monthlyUsageCycle.endAt.slice(0, 10),
    };
  } catch {
    return null;
  }
}
