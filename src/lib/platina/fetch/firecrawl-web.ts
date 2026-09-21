/**
 * Firecrawl as the first rung for ONE public web page (owner decision
 * 2026-09-21, CLAUDE.md). The Waters adapter asks `firecrawlPlan` whether a
 * target should go to Firecrawl; if Firecrawl fails in a way another scraper
 * could survive, the target falls through to the existing Apify crawler —
 * the same ladder idea as the model router, applied to scraping.
 *
 * Firecrawl gets:  competitor_site / press_release / trade_editorial /
 *                  conference targets that want exactly one page.
 * Apify keeps:     multi-page and sitemap crawls (Firecrawl /scrape is one
 *                  page; its crawl API is async and not wired), social
 *                  profiles/posts (Firecrawl refuses them: live 403), and
 *                  the Meta ad library (residential-proxy actor).
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
