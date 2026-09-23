/**
 * Shapes stored ops-board rows for Admin -> Health (C7.1). Pure.
 */
export type OpsStatus = "ok" | "degraded" | "down" | "not_configured";

const RANK: Record<OpsStatus, number> = { ok: 1, not_configured: 0, degraded: 2, down: 3 };

const asStatus = (s: string): OpsStatus =>
  s === "ok" || s === "degraded" || s === "down" || s === "not_configured" ? s : "degraded";

/**
 * The worst status of each check on each of the last `days` UTC days, oldest
 * first; null for a day with no run. One red hour makes the day red — the
 * strip answers "was anything wrong that day?".
 */
export function dailyStrip(
  history: { checkId: string; status: string; checkedAt: Date }[],
  now: Date,
  days = 7,
): Map<string, (OpsStatus | null)[]> {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const keys = Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - (days - 1 - i) * 86_400_000)));
  const out = new Map<string, (OpsStatus | null)[]>();
  for (const row of history) {
    const i = keys.indexOf(dayKey(row.checkedAt));
    if (i < 0) continue;
    const strip = out.get(row.checkId) ?? Array<OpsStatus | null>(days).fill(null);
    const status = asStatus(row.status);
    const current = strip[i];
    if (current === null || RANK[status] > RANK[current]) strip[i] = status;
    out.set(row.checkId, strip);
  }
  return out;
}

/** "3 min ago", "2 h ago", "yesterday". */
export function ago(then: Date, now: Date): string {
  const min = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
