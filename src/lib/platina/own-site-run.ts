/**
 * Executes one own-site pass for one client (C6 L1): list the site when the
 * list is stale, probe read pages (headers only), then read today's pages
 * through Firecrawl into first-party chunks. Every side effect goes through
 * `deps`, so the pass is unit-tested without a network or a database.
 *
 * A page failure never fails the pass; it is recorded on the page and
 * retried after OWN_SITE_RETRY_DAYS. A map failure keeps the known pages.
 */
import type { OwnSitePageStatus } from "@/db/platina-schema";
import { chunkMarkdown, localeOf, mapConcurrent, pickSitePages, SITE_READ_CONCURRENCY } from "@/lib/scrape/site";
import type { ProbeResult } from "./fetch/probe";
import {
  applyProbe,
  mergeSiteMap,
  needsRemap,
  pagesToProbe,
  pagesToRead,
  type OwnSitePageRow,
} from "./own-site";

/** Probes per pass: bounds the wall-clock time of one run. */
export const MAX_PROBES_PER_PASS = 120;
const PROBE_CONCURRENCY = 4;

export type OwnSiteClient = {
  id: string;
  kind: "own_brand" | "competitor";
  homepageUrl: string | null;
  ownSiteMappedAt: Date | null;
};

export type OwnSiteDeps = {
  getClient: (workspaceId: string, brandId: string) => Promise<OwnSiteClient | null>;
  getLimits: (workspaceId: string) => Promise<{ dailyPages: number; maxPages: number }>;
  listPages: (workspaceId: string, brandId: string) => Promise<OwnSitePageRow[]>;
  map: (url: string) => Promise<{ url: string; title?: string }[]>;
  insertPages: (
    workspaceId: string,
    brandId: string,
    pages: { url: string; title: string | null; priority: number }[],
  ) => Promise<void>;
  updatePage: (
    workspaceId: string,
    pageId: string,
    patch: Partial<{
      title: string | null;
      priority: number;
      status: OwnSitePageStatus;
      contentHash: string | null;
      etag: string | null;
      lastModified: string | null;
      changeDetectedAt: Date | null;
      chunkCount: number;
      error: string | null;
      lastReadAt: Date;
      lastCheckedAt: Date;
    }>,
  ) => Promise<void>;
  markGone: (workspaceId: string, pageIds: string[]) => Promise<void>;
  recordMap: (workspaceId: string, brandId: string, outcome: { mappedAt: Date | null; error: string | null }) => Promise<void>;
  probe: (url: string, prior: { etag: string | null; lastModified: string | null }) => Promise<ProbeResult>;
  scrape: (url: string) => Promise<{ url: string; title?: string; markdown: string }>;
  /** All-or-nothing batch embedding; null = unavailable. */
  embed: (texts: string[]) => Promise<number[][] | null>;
  hash: (text: string) => string;
  writeChunks: (input: {
    workspaceId: string;
    brandId: string;
    page: { id: string; url: string; title: string | null };
    /** embedding null = stored now, embedded later by the backfill. */
    chunks: { content: string; embedding: number[] | null }[];
  }) => Promise<void>;
  retireChunks: (workspaceId: string, pageIds: string[]) => Promise<void>;
  now: () => Date;
};

export type OwnSitePassResult =
  | { status: "skipped"; reason: string }
  | {
      status: "done";
      mapped: number | null;
      mapError: string | null;
      added: number;
      gone: number;
      probed: number;
      changed: number;
      read: number;
      unchanged: number;
      failed: number;
      /** Reads put off by a rate limit; they stay queued. */
      deferred: number;
      /** Passages stored without a vector (embedding outage), for the backfill. */
      unembedded: number;
      rateLimited: boolean;
      budgetLeft: number;
    };

/**
 * A URL in the locale to read the site in: English when the site has any
 * English pages (the working language; a big archive of German application
 * notes must not outvote it, as happened live on waters.com), then its most
 * common region; otherwise the site's most common locale. Null when no
 * link shows a locale.
 */
export function dominantLocaleUrl(links: { url: string }[]): string | null {
  const counts = new Map<string, { n: number; url: string; language: string }>();
  for (const link of links) {
    const locale = localeOf(link.url);
    if (!locale) continue;
    const key = `${locale.region ?? ""}/${locale.language}`;
    const entry = counts.get(key);
    if (entry) entry.n += 1;
    else counts.set(key, { n: 1, url: link.url, language: locale.language });
  }
  const all = [...counts.values()];
  const english = all.filter((e) => e.language === "en");
  let best: { n: number; url: string; language: string } | null = null;
  for (const entry of english.length > 0 ? english : all) {
    if (!best || entry.n > best.n) best = entry;
  }
  return best?.url ?? null;
}

/** A provider saying "slow down" (HTTP 429), not a page problem. */
export function isRateLimit(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return status === 429 || /429|rate.?limit/i.test(message(error));
}

function startOfUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runOwnSitePass(
  deps: OwnSiteDeps,
  input: {
    workspaceId: string;
    brandId: string;
    forceRemap?: boolean;
    /** Reads in this call (the job batches steps to stay inside a function timeout). */
    maxReads?: number;
  },
): Promise<OwnSitePassResult> {
  const { workspaceId, brandId } = input;
  const client = await deps.getClient(workspaceId, brandId);
  if (!client) return { status: "skipped", reason: "client not found" };
  if (client.kind !== "own_brand") return { status: "skipped", reason: "only a client's own site is first-party" };
  if (!client.homepageUrl) return { status: "skipped", reason: "the client has no website set" };

  const limits = await deps.getLimits(workspaceId);
  const now = deps.now();
  let pages = await deps.listPages(workspaceId, brandId);

  // 1. List the site when the list is stale.
  let mapped: number | null = null;
  let mapError: string | null = null;
  let added = 0;
  let gone = 0;
  if (input.forceRemap || needsRemap(client.ownSiteMappedAt, now)) {
    try {
      const links = await deps.map(client.homepageUrl);
      const picked = pickSitePages({
        startUrl: client.homepageUrl,
        // A bare homepage says nothing about language; the site's own most
        // common locale does, so one language (and region) is kept.
        localeUrl: dominantLocaleUrl(links) ?? undefined,
        links: [{ url: client.homepageUrl }, ...links],
        max: limits.maxPages,
        keepAll: true,
      });
      // pickSitePages never returns the start page itself; it is always kept.
      const withHome = [{ url: client.homepageUrl, score: 10 }, ...picked];
      const merge = mergeSiteMap(pages, withHome, limits.maxPages);
      await deps.insertPages(workspaceId, brandId, merge.insert);
      for (const u of merge.update) {
        await deps.updatePage(workspaceId, u.id, {
          priority: u.priority,
          ...(u.title ? { title: u.title } : {}),
          ...(u.requeue ? { status: "queued" as const, error: null } : {}),
        });
      }
      await deps.markGone(workspaceId, merge.gone);
      await deps.retireChunks(workspaceId, merge.gone);
      await deps.recordMap(workspaceId, brandId, { mappedAt: now, error: null });
      mapped = links.length;
      added = merge.insert.length;
      gone = merge.gone.length;
      pages = await deps.listPages(workspaceId, brandId);
    } catch (error) {
      mapError = message(error);
      await deps.recordMap(workspaceId, brandId, { mappedAt: null, error: mapError });
    }
  }

  // 2. Probe read pages (headers only, no credits).
  const due = pagesToProbe(pages, now).slice(0, MAX_PROBES_PER_PASS);
  let changed = 0;
  await mapConcurrent(due, PROBE_CONCURRENCY, async (page) => {
    const result = await deps
      .probe(page.url, { etag: page.etag, lastModified: page.lastModified })
      .catch((): ProbeResult => ({ outcome: "unsupported" }));
    const update = applyProbe(page, result, now);
    if (update.changeDetectedAt) changed += 1;
    await deps.updatePage(workspaceId, page.id, update);
    page.changeDetectedAt = update.changeDetectedAt;
    page.lastCheckedAt = update.lastCheckedAt;
  });

  // 3. Read today's pages within the daily budget.
  const dayStart = startOfUtcDay(now);
  const readToday = pages.filter((p) => p.lastReadAt && p.lastReadAt.getTime() >= dayStart).length;
  const budget = Math.max(0, limits.dailyPages - readToday);
  const toRead = pagesToRead(pages, Math.min(budget, input.maxReads ?? budget), now);
  const seen = new Set<string>();
  let read = 0;
  let unchanged = 0;
  let failed = 0;
  let deferred = 0;
  let unembedded = 0;
  // After a rate limit the rest of today's reads wait for the next batch:
  // hammering a limiting API only turns queued pages into failed ones.
  let rateLimited = false;
  await mapConcurrent(toRead, SITE_READ_CONCURRENCY, async (page) => {
    if (rateLimited) {
      deferred += 1;
      return;
    }
    try {
      const scraped = await deps.scrape(page.url);
      const markdown = scraped.markdown?.trim() ?? "";
      if (!markdown) throw new Error("the page has no readable text");
      const title = scraped.title?.trim() || page.title;
      const contentHash = deps.hash(markdown);
      // Validators for the next probe; without them the first probe would
      // report "changed" and re-read a page we just read.
      const baseline = await deps
        .probe(page.url, { etag: null, lastModified: null })
        .catch((): ProbeResult => ({ outcome: "unsupported" }));
      const validators =
        baseline.outcome === "changed" ? { etag: baseline.etag, lastModified: baseline.lastModified } : {};
      const readAt = deps.now();

      if (page.status === "read" && page.contentHash === contentHash) {
        unchanged += 1;
        await deps.updatePage(workspaceId, page.id, {
          ...validators,
          status: "read",
          changeDetectedAt: null,
          lastReadAt: readAt,
          lastCheckedAt: readAt,
          error: null,
        });
        return;
      }

      const texts = chunkMarkdown(markdown, title, seen);
      // An embedding outage (quota, throttle) must not waste the credit just
      // spent reading the page: the text is stored now and the daily backfill
      // embeds it. Until then it is on record but not yet retrievable.
      const vectors = texts.length > 0 ? await deps.embed(texts) : [];
      if (!vectors) unembedded += texts.length;
      const chunks = texts.map((content, i) => ({ content, embedding: vectors ? vectors[i] : null }));
      await deps.writeChunks({ workspaceId, brandId, page: { id: page.id, url: page.url, title }, chunks });
      await deps.updatePage(workspaceId, page.id, {
        ...validators,
        title,
        status: "read",
        contentHash,
        chunkCount: chunks.length,
        changeDetectedAt: null,
        lastReadAt: readAt,
        lastCheckedAt: readAt,
        error: null,
      });
      read += 1;
    } catch (error) {
      if (isRateLimit(error)) {
        rateLimited = true;
        deferred += 1;
        // Not a page failure: it stays where it was in the queue.
        await deps.updatePage(workspaceId, page.id, { error: message(error).slice(0, 500) });
        return;
      }
      failed += 1;
      await deps.updatePage(workspaceId, page.id, {
        status: page.status === "read" ? "read" : "failed",
        error: message(error).slice(0, 500),
        // A read page that failed to re-read keeps its old chunks and is
        // tried again after the retry wait via the next probe.
        changeDetectedAt: null,
      });
    }
  });

  return {
    status: "done",
    mapped,
    mapError,
    added,
    gone,
    probed: due.length,
    changed,
    read,
    unchanged,
    failed,
    deferred,
    unembedded,
    rateLimited,
    budgetLeft: Math.max(0, budget - toRead.length + deferred),
  };
}
