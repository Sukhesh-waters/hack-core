/**
 * Firecrawl as the first rung for ONE public web page (owner decision
 * 2026-09-21, CLAUDE.md). The Waters adapter asks `firecrawlPlan` whether a
 * target should go to Firecrawl; if Firecrawl fails in a way another scraper
 * could survive, the target falls through to the existing Apify crawler —
 * the same ladder idea as the model router, applied to scraping.
 *
 * Firecrawl gets:  competitor_site / press_release / trade_editorial /
 *                  conference targets — one page (single-page rung) or
 *                  several picked pages of the same site (site rung, below).
 * Apify keeps:     social profiles/posts (Firecrawl refuses them: live 403),
 *                  the Meta ad library (residential-proxy actor), and every
 *                  web target Firecrawl could not read (the fallback).
 *
 * Plane B like every Apify doc: public/raw, canonical URL + content hash,
 * never embedded, never citable. Firecrawl's metadata — and its JSON
 * extraction when enabled — lands in the `raw` jsonb column.
 */
import type { PlatinaScanTarget } from "@/db/platina-schema";
import {
  ScrapeError,
  firecrawlConfigured,
  isUnsupportedByFirecrawl,
  type ScrapedPage,
} from "@/lib/scrape/firecrawl";
import { mapConcurrent, pickSitePages } from "@/lib/scrape/site";
import { isSocialKind } from "./actors";
import { canonicalizeUrl, contentHash } from "./canonical";
import type { RawSignalDoc } from "./registry";

const PAGE_KINDS = new Set<PlatinaScanTarget["kind"]>([
  "competitor_site",
  "press_release",
  "trade_editorial",
  "conference",
]);

/**
 * Serve Firecrawl's cached copy only if it is this fresh. Its default is two
 * days, which would hide exactly the change a scan exists to notice.
 */
export const FIRECRAWL_MAX_AGE_MS = 10 * 60_000;

/**
 * Structured marketing signals, extracted by Firecrawl's LLM. 5 credits a page
 * instead of 1, and our own debate already reads the markdown, so it is
 * opt-in: FIRECRAWL_EXTRACT_JSON=on.
 */
export const SIGNAL_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "The page's main message" },
    offers: { type: "array", items: { type: "string" }, description: "Products, services or promotions offered" },
    prices: { type: "array", items: { type: "string" }, description: "Prices or discounts exactly as written" },
    claims: { type: "array", items: { type: "string" }, description: "Performance, quality or superiority claims" },
    announcements: { type: "array", items: { type: "string" }, description: "News, launches, partnerships, events" },
    calls_to_action: { type: "array", items: { type: "string" } },
    audience: { type: "string", description: "Who the page speaks to" },
  },
} as const;

export const SIGNAL_PROMPT =
  "Extract the marketing signals on this page, quoting the page's own words. Leave a field empty rather than guessing.";

export function extractJsonEnabled(): boolean {
  return /^(1|on|true|yes)$/i.test(process.env.FIRECRAWL_EXTRACT_JSON ?? "");
}

/** Whether this target should try Firecrawl first. Pure given config. */
export function firecrawlPlan(
  target: Pick<PlatinaScanTarget, "kind" | "value" | "seedFromSitemap">,
  pages: number,
  configured: boolean = firecrawlConfigured(),
): boolean {
  if (!configured) return false;
  if (!PAGE_KINDS.has(target.kind) || isSocialKind(target.kind)) return false;
  if (pages !== 1 || target.seedFromSitemap) return false;
  return !isUnsupportedByFirecrawl(target.value);
}

/**
 * Whether a Firecrawl failure should fall through to Apify. A page that
 * answered 404 is gone for every scraper — paying Apify to hear it again is
 * waste; an outage, used-up credits or a timeout is Firecrawl's problem only.
 */
export function shouldFallBack(error: unknown): boolean {
  return !(error instanceof ScrapeError) || error.retryable;
}

export function mapFirecrawlPage(
  page: ScrapedPage,
  target: PlatinaScanTarget,
): RawSignalDoc {
  const canonical = canonicalizeUrl(page.url || target.value);
  return {
    sourceUrl: target.value,
    canonicalUrl: canonical,
    title: page.title,
    body: page.markdown,
    adapter: "firecrawl",
    sourceKind: target.kind,
    contentHash: contentHash(canonical, page.markdown),
    raw: {
      provider: "firecrawl",
      url: page.url,
      title: page.title ?? null,
      description: page.description ?? null,
      statusCode: page.statusCode ?? null,
      creditsUsed: page.creditsUsed ?? null,
      scrapedAt: page.scrapedAt,
      extracted: page.json ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// The site rung — several pages of one site (slice C1, 2026-09-21)
// ---------------------------------------------------------------------------

/**
 * Live Waters onboarding: every source wanted 3–5 pages, so the single-page
 * rung above never fired (45/45 documents via Apify), and Apify's crawl
 * followed navigation links — 6 of 18 competitor pages were contact, sign-in
 * or menu pages, and the real Waters newsroom (ir.waters.com) was never seen.
 *
 * The site rung instead: reads the start page, lists the site (Firecrawl map,
 * 1 credit), PICKS the pages that describe the business (shared picker in
 * lib/scrape/site.ts — same one the vault uses), and reads those. The picked
 * list is remembered on the target for a week, so a re-collection costs one
 * credit per page and nothing to re-list.
 */
export const PICKED_PAGES_TTL_DAYS = 7;
/** Firecrawl's plan caps concurrent browsers; 4 pushed pages onto the fallback. */
const SITE_CONCURRENCY = 2;

/** Whether a multi-page target should take the site rung. Pure given config. */
export function firecrawlSitePlan(
  target: Pick<PlatinaScanTarget, "kind" | "value">,
  pages: number,
  configured: boolean = firecrawlConfigured(),
): boolean {
  if (!configured || pages < 2) return false;
  if (!PAGE_KINDS.has(target.kind) || isSocialKind(target.kind)) return false;
  return !isUnsupportedByFirecrawl(target.value);
}

/** The remembered picks, while still fresh. */
export function cachedPicks(
  target: Pick<PlatinaScanTarget, "pickedPages" | "pickedAt">,
  now: Date = new Date(),
): string[] | null {
  if (!target.pickedPages?.length || !target.pickedAt) return null;
  const age = now.getTime() - new Date(target.pickedAt).getTime();
  if (!Number.isFinite(age) || age > PICKED_PAGES_TTL_DAYS * 86_400_000) return null;
  return target.pickedPages;
}

export type SiteCollection = {
  docs: RawSignalDoc[];
  /** Pages read (what the page budget is charged). */
  pages: number;
  /** Set when the picks were chosen now (to be remembered on the target). */
  picked?: string[];
  /** Pages that could not be read — a note, never a failure. */
  skipped: { url: string; reason: string }[];
};

export type SiteDeps = {
  scrape: (url: string) => Promise<ScrapedPage>;
  map: (url: string) => Promise<{ url: string; title?: string }[]>;
  now?: Date;
};

/**
 * Reads up to `pages` pages of the target's site. The start page is required:
 * if it fails the error propagates so the caller can fall back to Apify. The
 * other pages are best-effort.
 */
export async function collectSiteWithFirecrawl(
  target: PlatinaScanTarget,
  pages: number,
  deps: SiteDeps,
): Promise<SiteCollection> {
  const skipped: SiteCollection["skipped"] = [];
  const first = await deps.scrape(target.value);
  const docs: RawSignalDoc[] = [mapFirecrawlPage(first, target)];

  let urls = cachedPicks(target, deps.now);
  let picked: string[] | undefined;
  if (!urls) {
    try {
      const links = await deps.map(target.value);
      urls = pickSitePages({
        startUrl: target.value,
        referenceUrl: first.url,
        links,
        max: pages - 1,
      }).map((p) => p.url);
      picked = urls;
    } catch (error) {
      skipped.push({
        url: target.value,
        reason: `could not list the site: ${error instanceof Error ? error.message : String(error)}`,
      });
      urls = [];
    }
  }

  const rest = await mapConcurrent(urls.slice(0, pages - 1), SITE_CONCURRENCY, async (url) => {
    try {
      return mapFirecrawlPage(await deps.scrape(url), { ...target, value: url });
    } catch (error) {
      skipped.push({ url, reason: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });
  for (const doc of rest) {
    // Picked pages keep the SOURCE's url so they file under the same target,
    // like an Apify multi-page crawl did.
    if (doc) docs.push({ ...doc, sourceUrl: target.value });
  }
  return { docs, pages: docs.length, picked, skipped };
}
