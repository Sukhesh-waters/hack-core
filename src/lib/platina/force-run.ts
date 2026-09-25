/**
 * Force run (C8.0 F0.5). Pure planner behind scripts/platina-force.ts: which
 * approved sources to collect NOW, outside their schedule, how many pages
 * each may read (the operator's seed grant, recorded on the run), and what
 * that is projected to cost against the real account balances.
 *
 * "Force" means running the real pipeline early, never writing rows by
 * hand: every document still comes from Firecrawl or Apify through the same
 * adapters, gates and provenance. The grant bypasses only the workspace daily
 * cap; each source's own daily limit still applies, and the whole plan is
 * refused when it would eat into the reserve left on either account.
 */
import type { PlatinaScanTarget } from "@/db/platina-schema";
import { clampPages, isSocialKind } from "./fetch/actors";

export const FORCE_FLOWS = ["client", "competitors", "linkedin", "conferences", "ads"] as const;
export type ForceFlow = (typeof FORCE_FLOWS)[number];

/**
 * Cost estimates, labelled as such everywhere they are shown. Web pages are
 * read by Firecrawl (1 credit a page, +1 to list a site the first time).
 * Apify prices from the account's own history (2026-09-21: 151 LinkedIn posts
 * for about $0.30) and the ad-library actor's 10-result minimum charge.
 */
export const ESTIMATE = {
  apifyUsdPerPost: 0.002,
  apifyUsdPerAd: 0.0075,
  adMinimumResults: 10,
  firecrawlCreditsPerPage: 1,
  firecrawlCreditsPerSiteMap: 1,
} as const;

/** Never plan into the last of either account. */
export const RESERVE = { apifyUsd: 1, firecrawlCredits: 100 } as const;

export type ForceTarget = {
  kind: PlatinaScanTarget["kind"];
  maxPages?: number;
  backfill?: { posts?: number } | null;
  pickedPages?: string[];
};

export type ForceSpec = {
  id: string;
  name: string;
  status: string;
  enabled: boolean;
  /** Kind of the brand the source belongs to; null = workspace-wide (conference pages). */
  brandKind: "own_brand" | "competitor" | string | null;
  targets: ForceTarget[];
  /** The source's own daily limit, what is left of it today. */
  specRemaining: number;
};

export type ForcePlanItem = {
  specId: string;
  name: string;
  flow: ForceFlow;
  seedPages: number;
  firecrawlCredits: number;
  apifyUsd: number;
};

export type ForcePlan = {
  items: ForcePlanItem[];
  skipped: { name: string; reason: string }[];
  totals: { firecrawlCredits: number; apifyUsd: number; pages: number };
  /** Null when the plan fits; otherwise why nothing may run. */
  refusal: string | null;
};

const WEB_KINDS = new Set<PlatinaScanTarget["kind"]>(["competitor_site", "press_release", "trade_editorial", "conference"]);

export function flowOf(spec: Pick<ForceSpec, "brandKind" | "targets">): ForceFlow {
  const kinds = spec.targets.map((t) => t.kind);
  if (kinds.includes("ad_library")) return "ads";
  if (kinds.some((k) => isSocialKind(k))) return "linkedin";
  if (spec.brandKind === "own_brand") return "client";
  if (spec.brandKind === null && kinds.every((k) => k === "conference")) return "conferences";
  return "competitors";
}

function targetPages(t: ForceTarget): number {
  return clampPages(t.backfill?.posts ?? t.maxPages);
}

/** Projected cost of reading `pages` from one target. */
export function targetCost(t: ForceTarget, pages: number): { firecrawlCredits: number; apifyUsd: number } {
  if (pages <= 0) return { firecrawlCredits: 0, apifyUsd: 0 };
  if (t.kind === "ad_library") {
    return { firecrawlCredits: 0, apifyUsd: Math.max(pages, ESTIMATE.adMinimumResults) * ESTIMATE.apifyUsdPerAd };
  }
  if (isSocialKind(t.kind)) return { firecrawlCredits: 0, apifyUsd: pages * ESTIMATE.apifyUsdPerPost };
  if (WEB_KINDS.has(t.kind)) {
    const needsMap = pages > 1 && !(t.pickedPages && t.pickedPages.length > 0);
    return {
      firecrawlCredits: pages * ESTIMATE.firecrawlCreditsPerPage + (needsMap ? ESTIMATE.firecrawlCreditsPerSiteMap : 0),
      apifyUsd: 0,
    };
  }
  return { firecrawlCredits: 0, apifyUsd: 0 };
}

const round = (usd: number) => Math.round(usd * 1000) / 1000;

export function planForceRun(input: {
  specs: ForceSpec[];
  flows: ForceFlow[];
  /** Balances left this period; null = unknown (the plan is refused). */
  remaining: { apifyUsd: number | null; firecrawlCredits: number | null };
}): ForcePlan {
  const items: ForcePlanItem[] = [];
  const skipped: ForcePlan["skipped"] = [];

  for (const spec of input.specs) {
    const flow = flowOf(spec);
    if (!input.flows.includes(flow)) continue;
    if (spec.status !== "approved") {
      skipped.push({ name: spec.name, reason: "not approved yet" });
      continue;
    }
    if (!spec.enabled) {
      skipped.push({ name: spec.name, reason: "turned off (held pages only, never re-read)" });
      continue;
    }
    if (spec.specRemaining <= 0) {
      skipped.push({ name: spec.name, reason: "this source's own daily limit is used up; it runs tomorrow" });
      continue;
    }
    let left = spec.specRemaining;
    let firecrawlCredits = 0;
    let apifyUsd = 0;
    let pages = 0;
    for (const t of spec.targets) {
      const read = Math.min(targetPages(t), left);
      const cost = targetCost(t, read);
      firecrawlCredits += cost.firecrawlCredits;
      apifyUsd += cost.apifyUsd;
      pages += read;
      left -= read;
    }
    if (pages === 0) {
      skipped.push({ name: spec.name, reason: "nothing to read" });
      continue;
    }
    items.push({ specId: spec.id, name: spec.name, flow, seedPages: pages, firecrawlCredits, apifyUsd: round(apifyUsd) });
  }

  const totals = {
    firecrawlCredits: items.reduce((s, i) => s + i.firecrawlCredits, 0),
    apifyUsd: round(items.reduce((s, i) => s + i.apifyUsd, 0)),
    pages: items.reduce((s, i) => s + i.seedPages, 0),
  };

  let refusal: string | null = null;
  const { apifyUsd, firecrawlCredits } = input.remaining;
  if (totals.apifyUsd > 0 && apifyUsd === null) refusal = "Apify balance unknown: check APIFY_TOKEN before a paid run.";
  else if (totals.firecrawlCredits > 0 && firecrawlCredits === null)
    refusal = "Firecrawl balance unknown: check FIRECRAWL_API_KEY before a paid run.";
  else if (apifyUsd !== null && totals.apifyUsd > apifyUsd - RESERVE.apifyUsd)
    refusal = `Projected Apify $${totals.apifyUsd.toFixed(2)} would leave less than the $${RESERVE.apifyUsd} reserve ($${apifyUsd.toFixed(2)} left).`;
  else if (firecrawlCredits !== null && totals.firecrawlCredits > firecrawlCredits - RESERVE.firecrawlCredits)
    refusal = `Projected ${totals.firecrawlCredits} Firecrawl credits would leave less than the ${RESERVE.firecrawlCredits}-credit reserve (${firecrawlCredits} left).`;

  return { items, skipped, totals, refusal };
}
