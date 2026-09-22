/**
 * A client's OWN website as first-party knowledge (C6 L1, owner decision
 * 2026-09-22). Pure decisions; the job in inngest/functions/platina/own-site
 * executes them.
 *
 * Every same-site, same-language page that survives the noise filters is
 * kept (products and applications first), up to the workspace's page cap.
 * A daily budget spreads the first read over several days. After a page is
 * read, a header-only probe (no page content) decides whether it changed;
 * only a changed page, or one whose server gives no validators and was read
 * long ago, spends a credit again.
 */
import type { OwnSitePageStatus } from "@/db/platina-schema";
import type { ProbeResult } from "./fetch/probe";

/** Re-list the site's pages this often, to find new pages and removed ones. */
export const OWN_SITE_REMAP_DAYS = 7;
/** Probe a read page this often. */
export const OWN_SITE_RECHECK_DAYS = 3;
/** A page whose server sends no ETag/Last-Modified is re-read this often. */
export const OWN_SITE_BLIND_REREAD_DAYS = 30;
/** A failed page waits this long before another try. */
export const OWN_SITE_RETRY_DAYS = 7;

const DAY_MS = 86_400_000;

export type OwnSitePageRow = {
  id: string;
  url: string;
  title: string | null;
  priority: number;
  status: OwnSitePageStatus;
  contentHash: string | null;
  etag: string | null;
  lastModified: string | null;
  changeDetectedAt: Date | null;
  lastReadAt: Date | null;
  lastCheckedAt: Date | null;
  updatedAt: Date;
};

export type MappedPage = { url: string; title?: string; score: number };

export type SiteMapMerge = {
  insert: { url: string; title: string | null; priority: number }[];
  /** Known pages still on the site: new priority/title; a "gone" page returns to the queue. */
  update: { id: string; title: string | null; priority: number; requeue: boolean }[];
  /** Known pages no longer on the site. Their chunks are superseded. */
  gone: string[];
};

/** Normalised identity of a URL: no hash, no trailing slash. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * Reconciles a fresh site map with the pages already known. The map is
 * already filtered and ordered (pickSitePages with keepAll); only the best
 * `max` pages are kept.
 */
export function mergeSiteMap(
  existing: Pick<OwnSitePageRow, "id" | "url" | "status">[],
  mapped: MappedPage[],
  max: number,
): SiteMapMerge {
  const kept = mapped.slice(0, Math.max(0, max));
  const byKey = new Map(existing.map((p) => [pageKey(p.url), p]));
  const seen = new Set<string>();
  const insert: SiteMapMerge["insert"] = [];
  const update: SiteMapMerge["update"] = [];
  for (const page of kept) {
    const key = pageKey(page.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = byKey.get(key);
    const title = page.title?.trim() || null;
    if (known) {
      update.push({ id: known.id, title, priority: page.score, requeue: known.status === "gone" });
    } else {
      insert.push({ url: page.url, title, priority: page.score });
    }
  }
  const gone = existing
    .filter((p) => p.status !== "gone" && !seen.has(pageKey(p.url)))
    .map((p) => p.id);
  return { insert, update, gone };
}

/** True when the site's page list is older than OWN_SITE_REMAP_DAYS (or never made). */
export function needsRemap(lastMappedAt: Date | null, now: Date): boolean {
  return !lastMappedAt || now.getTime() - lastMappedAt.getTime() >= OWN_SITE_REMAP_DAYS * DAY_MS;
}

/** Read pages due a header probe: not already flagged, not checked recently. */
export function pagesToProbe(pages: OwnSitePageRow[], now: Date): OwnSitePageRow[] {
  return pages.filter(
    (p) =>
      p.status === "read" &&
      !p.changeDetectedAt &&
      (!p.lastCheckedAt || now.getTime() - p.lastCheckedAt.getTime() >= OWN_SITE_RECHECK_DAYS * DAY_MS),
  );
}

export type ProbeUpdate = {
  lastCheckedAt: Date;
  changeDetectedAt: Date | null;
  etag?: string | null;
  lastModified?: string | null;
};

/**
 * What a probe result means for a page. "changed" flags it for a re-read.
 * "unsupported" (no validators, or the probe failed) re-reads it only after
 * OWN_SITE_BLIND_REREAD_DAYS, so a server without validators costs one
 * credit a month per page, not one per probe.
 */
export function applyProbe(page: OwnSitePageRow, result: ProbeResult, now: Date): ProbeUpdate {
  if (result.outcome === "changed") {
    return {
      lastCheckedAt: now,
      changeDetectedAt: now,
      etag: result.etag,
      lastModified: result.lastModified,
    };
  }
  if (result.outcome === "unchanged") return { lastCheckedAt: now, changeDetectedAt: null };
  const stale =
    !page.lastReadAt || now.getTime() - page.lastReadAt.getTime() >= OWN_SITE_BLIND_REREAD_DAYS * DAY_MS;
  return { lastCheckedAt: now, changeDetectedAt: stale ? now : null };
}

/**
 * The pages to read today, within the budget: changed pages first (oldest
 * change first), then never-read pages by priority, then failed pages whose
 * retry wait is over.
 */
export function pagesToRead(pages: OwnSitePageRow[], budget: number, now: Date): OwnSitePageRow[] {
  if (budget <= 0) return [];
  const changed = pages
    .filter((p) => p.status === "read" && p.changeDetectedAt)
    .sort((a, b) => a.changeDetectedAt!.getTime() - b.changeDetectedAt!.getTime());
  const queued = pages
    .filter((p) => p.status === "queued")
    .sort((a, b) => b.priority - a.priority || a.url.length - b.url.length);
  const retry = pages
    .filter(
      (p) => p.status === "failed" && now.getTime() - p.updatedAt.getTime() >= OWN_SITE_RETRY_DAYS * DAY_MS,
    )
    .sort((a, b) => b.priority - a.priority);
  return [...changed, ...queued, ...retry].slice(0, budget);
}

export type OwnSiteSummary = {
  total: number;
  read: number;
  queued: number;
  failed: number;
  changed: number;
  gone: number;
  lastReadAt: Date | null;
};

export function summariseOwnSite(pages: OwnSitePageRow[]): OwnSiteSummary {
  const summary: OwnSiteSummary = { total: 0, read: 0, queued: 0, failed: 0, changed: 0, gone: 0, lastReadAt: null };
  for (const p of pages) {
    if (p.status === "gone") {
      summary.gone += 1;
      continue;
    }
    summary.total += 1;
    if (p.status === "read") summary.read += 1;
    if (p.status === "queued") summary.queued += 1;
    if (p.status === "failed") summary.failed += 1;
    if (p.status === "read" && p.changeDetectedAt) summary.changed += 1;
    if (p.lastReadAt && (!summary.lastReadAt || p.lastReadAt > summary.lastReadAt)) {
      summary.lastReadAt = p.lastReadAt;
    }
  }
  return summary;
}
