/**
 * The ops board's checks (C7.1). Pure: each turns already-gathered facts into
 * one HealthCheck (same shape and statuses as the collection health page), so
 * every rule is unit-tested without a database, a provider or a clock.
 *
 *   ok = green, degraded = amber, down = red, not_configured = grey.
 *
 * Each check answers one question someone would otherwise have to run a
 * script for, and names the next action when it is not green. The facts are
 * gathered by lib/ops/collect.ts; the job, the script and the page all run
 * the same functions, so "the board says" and "the script says" never differ.
 */
import type { HealthCheck } from "@/lib/platina/health";

export type OpsCheck = HealthCheck & {
  /** Numbers behind the status, for the 7-day history. */
  value?: Record<string, number | string | null>;
};

const DAY = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// 1. First-party knowledge holds only the client's own pages (F1 can't return)
// ---------------------------------------------------------------------------

export function checkKnowledgeOwnership(input: {
  /** Sources whose URL is not on their client's own list. */
  notOwn: { url: string; client: string; owner: string | null }[];
  /** Clients that have knowledge sources but no own list yet. */
  clientsWithoutOwnList: string[];
}): OpsCheck {
  const base = { id: "knowledge_ownership", label: "First-party knowledge is the client's own", required: false };
  if (input.notOwn.length > 0) {
    const sample = input.notOwn
      .slice(0, 3)
      .map((s) => `${s.owner ?? "unknown owner"} (${s.url})`)
      .join("; ");
    return {
      ...base,
      status: "down",
      detail: `${plural(input.notOwn.length, "page")} from other companies ${input.notOwn.length === 1 ? "is" : "are"} in a client's first-party knowledge base: ${sample}.`,
      remedy: "Run scripts/kb-quarantine.ts for that client (dry run first), then track those pages as competitor or market sources.",
      value: { notOwn: input.notOwn.length },
    };
  }
  if (input.clientsWithoutOwnList.length > 0) {
    return {
      ...base,
      status: "degraded",
      detail: `${input.clientsWithoutOwnList.join(", ")} ${input.clientsWithoutOwnList.length === 1 ? "has" : "have"} knowledge pages but no list of own sites, so nothing can be checked.`,
      remedy: "Add the client's website and social pages under Brand Gene -> Knowledge.",
      value: { notOwn: 0, unchecked: input.clientsWithoutOwnList.length },
    };
  }
  return { ...base, status: "ok", detail: "Every first-party page belongs to its client.", value: { notOwn: 0 } };
}

// ---------------------------------------------------------------------------
// 2. The client's own website keeps being read
// ---------------------------------------------------------------------------

export function checkOwnSite(input: {
  now: Date;
  sites: { client: string; total: number; read: number; queued: number; failed: number; lastReadAt: Date | null; error: string | null }[];
}): OpsCheck {
  const base = { id: "own_site", label: "Client websites (first-party)", required: false };
  if (input.sites.length === 0) {
    return { ...base, status: "not_configured", detail: "No client has a website set.", remedy: "Set the client's website on its Clients page." };
  }
  const stalled = input.sites.filter(
    (s) => s.queued > 0 && (!s.lastReadAt || input.now.getTime() - s.lastReadAt.getTime() > 2 * DAY),
  );
  const summary = input.sites
    .map((s) => `${s.client}: ${s.read}/${s.total} read, ${s.queued} queued, ${s.failed} failed`)
    .join("; ");
  const value = {
    read: input.sites.reduce((n, s) => n + s.read, 0),
    queued: input.sites.reduce((n, s) => n + s.queued, 0),
    failed: input.sites.reduce((n, s) => n + s.failed, 0),
  };
  const errored = input.sites.filter((s) => s.error);
  if (stalled.length > 0 || errored.length > 0) {
    return {
      ...base,
      status: "degraded",
      detail: `${summary}.${stalled.length ? ` Nothing read for 2 days while pages wait (${stalled.map((s) => s.client).join(", ")}).` : ""}${errored.length ? ` Listing failed: ${errored.map((s) => `${s.client} (${s.error})`).join(", ")}.` : ""}`,
      remedy: "Check that the job runner is up and Firecrawl has credits (Budgets below); then use 'Read now' on the client page.",
      value,
    };
  }
  return { ...base, status: "ok", detail: `${summary}.`, value };
}

// ---------------------------------------------------------------------------
// 3. Embeddings keep up (Gemini free quota, O1)
// ---------------------------------------------------------------------------

export function checkEmbeddings(input: { waiting: number; failures24h: number }): OpsCheck {
  const base = { id: "embeddings", label: "Embeddings (search vectors)", required: false };
  const value = { waiting: input.waiting, failures24h: input.failures24h };
  if (input.waiting > 500) {
    return {
      ...base,
      status: "down",
      detail: `${input.waiting} passages are waiting for an embedding and can't be found by search yet.`,
      remedy: "The free Gemini quota is the limit: a paid key (decision O1) clears the backlog in a day.",
      value,
    };
  }
  if (input.waiting > 0 || input.failures24h > 0) {
    return {
      ...base,
      status: "degraded",
      detail: `${plural(input.waiting, "passage")} waiting for an embedding; ${plural(input.failures24h, "failed embedding call")} in 24 h. The daily backfill catches up.`,
      value,
    };
  }
  return { ...base, status: "ok", detail: "Every passage has its embedding.", value };
}

// ---------------------------------------------------------------------------
// 4. Every watched source is collected on time
// ---------------------------------------------------------------------------

export function checkCollectionFreshness(input: {
  now: Date;
  sources: { name: string; cadenceMinutes: number; lastSuccessAt: Date | null; lastFailureAt: Date | null; createdAt: Date }[];
}): OpsCheck {
  const base = { id: "collection_freshness", label: "Sources collected on time", required: false };
  if (input.sources.length === 0) {
    return { ...base, status: "not_configured", detail: "No approved sources.", remedy: "Approve sources on Audits." };
  }
  // A daily-or-slower source is late after 2 cadences; a fast one after 2 days
  // (probes skip unchanged pages, so a quiet 5-minute source is not late).
  const late = input.sources.filter((s) => {
    const allowance = Math.max(2 * s.cadenceMinutes * 60_000, 2 * DAY);
    const since = s.lastSuccessAt ?? s.createdAt;
    return input.now.getTime() - since.getTime() > allowance;
  });
  const failing = input.sources.filter(
    (s) => s.lastFailureAt && (!s.lastSuccessAt || s.lastFailureAt > s.lastSuccessAt),
  );
  const value = { sources: input.sources.length, late: late.length, failing: failing.length };
  if (late.length > 0 || failing.length > 0) {
    const names = [...new Set([...late, ...failing].map((s) => s.name))].slice(0, 4).join(", ");
    return {
      ...base,
      status: late.length > input.sources.length / 2 ? "down" : "degraded",
      detail: `${plural(late.length, "source")} late, ${plural(failing.length, "source")} failing on the last try (${names}).`,
      remedy: "Open Admin -> Collection health; if the job runner is up, check the source's last error on Audits.",
      value,
    };
  }
  return { ...base, status: "ok", detail: `All ${input.sources.length} sources collected on time.`, value };
}

// ---------------------------------------------------------------------------
// 5. Events: the next in-person moments in the client's region
// ---------------------------------------------------------------------------

export function checkEvents(input: {
  now: Date;
  regionCountries: readonly string[];
  regionLabel: string;
  events: { name: string; startsOn: string | null; country: string | null }[];
}): OpsCheck {
  const base = { id: "events", label: "Events ahead", required: false };
  const today = input.now.toISOString().slice(0, 10);
  const upcoming = input.events.filter((e) => e.startsOn && e.startsOn >= today);
  const inRegion = upcoming.filter((e) => e.country && input.regionCountries.includes(e.country));
  const undated = input.events.filter((e) => !e.startsOn).length;
  const soon = inRegion
    .filter((e) => new Date(`${e.startsOn}T00:00:00Z`).getTime() - input.now.getTime() <= 60 * DAY)
    .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
  const value = { known: input.events.length, upcoming: upcoming.length, inRegion: inRegion.length, undated };
  if (input.events.length === 0) {
    return { ...base, status: "not_configured", detail: "No events known yet.", remedy: "Add conference pages as sources (Events).", value };
  }
  const next = soon[0] ? ` Next in ${input.regionLabel}: ${soon[0].name} on ${soon[0].startsOn}.` : "";
  const detail = `${upcoming.length} upcoming (${inRegion.length} in ${input.regionLabel}), ${undated} without a date.${next}`;
  if (soon.length === 0) {
    return {
      ...base,
      status: "degraded",
      detail: `${detail} Nothing known in ${input.regionLabel} for the next 60 days.`,
      remedy: "Add the region's show pages as conference sources so their dates are read.",
      value,
    };
  }
  return { ...base, status: "ok", detail, value };
}

// ---------------------------------------------------------------------------
// 6. Learning: what results are teaching, and the min-N gate holds
// ---------------------------------------------------------------------------

export function checkLearning(input: {
  results: number;
  pastMinN: number;
  minN: number;
  reviewsWaiting: number;
}): OpsCheck {
  const base = { id: "learning", label: "Learning from results", required: false };
  const value = { results: input.results, pastMinN: input.pastMinN, reviewsWaiting: input.reviewsWaiting };
  if (input.results === 0) {
    return {
      ...base,
      status: "degraded",
      detail: "No confirmed results yet, so rankings follow the rules only.",
      remedy: "Log posted creatives on Results and confirm their reviews.",
      value,
    };
  }
  const waiting = input.reviewsWaiting > 0 ? ` ${plural(input.reviewsWaiting, "review")} waiting for a person.` : "";
  return {
    ...base,
    status: "ok",
    detail: `${plural(input.results, "confirmed result")}; ${plural(input.pastMinN, "pattern")} past the min-N of ${input.minN}.${waiting}`,
    value,
  };
}

// ---------------------------------------------------------------------------
// 7. Budgets: Apify $5, Firecrawl credits, AI cost — projected to month end
// ---------------------------------------------------------------------------

export type SpendReading = {
  name: string;
  used: number;
  cap: number | null;
  unit: "usd" | "credits";
  periodStart: Date;
  periodEnd: Date;
} | { name: string; error: string };

/** Straight-line projection of `used` to the end of its period. */
export function projectSpend(used: number, periodStart: Date, periodEnd: Date, now: Date): number {
  const elapsed = Math.max(now.getTime() - periodStart.getTime(), DAY / 24);
  const total = periodEnd.getTime() - periodStart.getTime();
  return (used * total) / elapsed;
}

export function checkBudgets(input: { now: Date; readings: SpendReading[] }): OpsCheck {
  const base = { id: "budgets", label: "Budgets (projected to period end)", required: false };
  const fmt = (n: number, unit: "usd" | "credits") => (unit === "usd" ? `$${n.toFixed(2)}` : `${Math.round(n)} credits`);
  const parts: string[] = [];
  let worst: "ok" | "degraded" | "down" = "ok";
  const value: Record<string, number | null> = {};
  for (const r of input.readings) {
    if ("error" in r) {
      parts.push(`${r.name}: couldn't read (${r.error})`);
      if (worst === "ok") worst = "degraded";
      continue;
    }
    const projected = projectSpend(r.used, r.periodStart, r.periodEnd, input.now);
    value[`${r.name}.used`] = Number(r.used.toFixed(2));
    value[`${r.name}.projected`] = Number(projected.toFixed(2));
    if (r.cap === null) {
      parts.push(`${r.name}: ${fmt(r.used, r.unit)} so far, about ${fmt(projected, r.unit)} by ${r.periodEnd.toISOString().slice(0, 10)}`);
      continue;
    }
    const share = r.used / r.cap;
    parts.push(`${r.name}: ${fmt(r.used, r.unit)} of ${fmt(r.cap, r.unit)}, about ${fmt(projected, r.unit)} by ${r.periodEnd.toISOString().slice(0, 10)}`);
    if (share >= 1) worst = "down";
    else if ((share >= 0.8 || projected > r.cap) && worst !== "down") worst = "degraded";
  }
  return {
    ...base,
    status: worst,
    detail: `${parts.join("; ")}.`,
    remedy: worst === "ok" ? undefined : "Slow the cadence of the costliest sources, or raise the cap (owner decision D14).",
    value,
  };
}

// ---------------------------------------------------------------------------
// 8. Jobs: nothing stuck
// ---------------------------------------------------------------------------

export function checkStuckRuns(input: { now: Date; running: { id: string; startedAt: Date | null; queuedAt: Date }[] }): OpsCheck {
  const base = { id: "stuck_runs", label: "Runs finishing", required: false };
  const stuck = input.running.filter((r) => input.now.getTime() - (r.startedAt ?? r.queuedAt).getTime() > 60 * 60_000);
  if (stuck.length > 0) {
    return {
      ...base,
      status: "down",
      detail: `${plural(stuck.length, "run")} stuck for over an hour.`,
      remedy: "Restart the job runner (npm run dev:jobs); stuck runs are re-sent by the scan coordinator.",
      value: { stuck: stuck.length },
    };
  }
  return { ...base, status: "ok", detail: "No run has been stuck for over an hour.", value: { stuck: 0 } };
}

/** Red / amber counts for alert rules ("ops" source). */
export function opsTotals(checks: OpsCheck[]): { redChecks: number; amberChecks: number } {
  return {
    redChecks: checks.filter((c) => c.status === "down").length,
    amberChecks: checks.filter((c) => c.status === "degraded").length,
  };
}

/** Checks red now that were not red in the previous run: these raise an alert at once. */
export function newlyRed(previous: { checkId: string; status: string }[], current: OpsCheck[]): OpsCheck[] {
  const wasRed = new Set(previous.filter((p) => p.status === "down").map((p) => p.checkId));
  return current.filter((c) => c.status === "down" && !wasRed.has(c.id));
}
