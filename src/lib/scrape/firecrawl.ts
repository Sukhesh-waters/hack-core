/**
 * Firecrawl — hosted scraping for ONE public web page (owner decision
 * 2026-09-21, see CLAUDE.md). Shared infrastructure, like the model router:
 * Platina's web adapter and InstaMedia's paste-a-URL ingest both use it, so
 * it lives outside both products and imports neither.
 *
 * Measured on this account's key, 2026-09-21:
 *   markdown scrape of waters.com   1.3s, 1 credit, 8,496 chars of markdown
 *                                   (~2,650 once link syntax is stripped —
 *                                   on an easy page it is not "more text";
 *                                   its value is the pages a plain fetch
 *                                   cannot read: JavaScript apps, bot walls)
 *   + LLM JSON extraction           2.4s, 5 credits
 *   instagram.com                   403 "we do not support this site"
 *   plan                            1,000 credits / month
 *
 * So: markdown is the default (1 credit), JSON extraction is opt-in per call,
 * and social platforms are refused up front instead of spending a round trip
 * to be told no — they stay on Apify's platform-specific actors.
 *
 * Every failure is a ScrapeError whose message is written for a person
 * (lib/action-errors passes it through verbatim), with `retryable` telling a
 * caller whether a different scraper could still succeed.
 */

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

/** Longer than a heavy JS page, shorter than a server action's patience. */
export const FIRECRAWL_TIMEOUT_MS = 45_000;

/** Hosts Firecrawl refuses (live 403) — Apify's social actors cover these. */
const UNSUPPORTED_HOSTS = [
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
];

export class ScrapeError extends Error {
  constructor(
    message: string,
    /** True when another scraper might succeed (outage, credits, timeout). */
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}

export type ScrapedPage = {
  /** The URL the page was finally served from (after redirects). */
  url: string;
  title?: string;
  description?: string;
  /** Clean main-content markdown. */
  markdown: string;
  /** Structured extraction — present only when a schema was asked for. */
  json?: Record<string, unknown>;
  /** HTTP status of the target page itself. */
  statusCode?: number;
  creditsUsed?: number;
  scrapedAt: string;
};

export function firecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

export function isUnsupportedByFirecrawl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return UNSUPPORTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Maps Firecrawl's answer to a message a person can act on. Pure, so every
 * status is unit-tested without a network.
 */
export function describeFirecrawlFailure(
  status: number,
  detail: string,
): { message: string; retryable: boolean } {
  if (status === 401) {
    return {
      message: "Firecrawl rejected the API key (401) — check FIRECRAWL_API_KEY in .env.local.",
      retryable: true,
    };
  }
  if (status === 402) {
    return {
      message: "Firecrawl credits are used up for this billing period (402).",
      retryable: true,
    };
  }
  if (status === 429) {
    return { message: "Firecrawl is rate-limiting right now (429).", retryable: true };
  }
  if (status === 403 && /do not support this site/i.test(detail)) {
    return {
      message: "Firecrawl does not read this site (social platforms are refused).",
      retryable: true,
    };
  }
  if (status === 408) {
    return { message: "The page took too long to load (408).", retryable: true };
  }
  return {
    message: `Firecrawl could not read the page (${status})${detail ? `: ${detail.slice(0, 160)}` : ""}.`,
    retryable: status >= 500,
  };
}

export async function scrapeWithFirecrawl(
  url: string,
  options: {
    /** JSON Schema for LLM extraction. Costs 5 credits instead of 1. */
    jsonSchema?: Record<string, unknown>;
    jsonPrompt?: string;
    /** Serve a cached copy up to this age (Firecrawl `maxAge`), in ms. */
    maxAgeMs?: number;
  } = {},
): Promise<ScrapedPage> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new ScrapeError("FIRECRAWL_API_KEY is not set.", true);
  if (isUnsupportedByFirecrawl(url)) {
    throw new ScrapeError(
      "Firecrawl does not read this site (social platforms are refused).",
      true,
      403,
    );
  }

  const formats: unknown[] = ["markdown"];
  if (options.jsonSchema) {
    formats.push({
      type: "json",
      schema: options.jsonSchema,
      ...(options.jsonPrompt ? { prompt: options.jsonPrompt } : {}),
    });
  }

  let response: Response;
  try {
    response = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        url,
        formats,
        onlyMainContent: true,
        timeout: FIRECRAWL_TIMEOUT_MS - 5_000,
        ...(options.maxAgeMs !== undefined ? { maxAge: options.maxAgeMs } : {}),
      }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ScrapeError(
      timedOut
        ? "Firecrawl did not answer in time."
        : "Firecrawl could not be reached (network error).",
      true,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: {
      markdown?: string;
      json?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
  };

  if (!response.ok || payload.success === false) {
    const { message, retryable } = describeFirecrawlFailure(
      response.ok ? 500 : response.status,
      typeof payload.error === "string" ? payload.error : "",
    );
    throw new ScrapeError(message, retryable, response.status);
  }

  const data = payload.data ?? {};
  const meta = data.metadata ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const statusCode = typeof meta.statusCode === "number" ? meta.statusCode : undefined;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";

  // Firecrawl reports the TARGET's status separately: a 200 from Firecrawl
  // wrapping a 404 page is not a page.
  if (statusCode !== undefined && statusCode >= 400) {
    throw new ScrapeError(`The page answered ${statusCode}.`, statusCode >= 500, statusCode);
  }
  if (!markdown.trim()) {
    throw new ScrapeError("Firecrawl returned an empty page.", true);
  }

  return {
    url: str(meta.url) ?? str(meta.sourceURL) ?? url,
    title: str(meta.title) ?? str(meta.ogTitle),
    description: str(meta.description) ?? str(meta.ogDescription),
    markdown,
    json: data.json && typeof data.json === "object" ? data.json : undefined,
    statusCode,
    creditsUsed: typeof meta.creditsUsed === "number" ? meta.creditsUsed : undefined,
    scrapedAt: new Date().toISOString(),
  };
}

/** Remaining credits, for the health script. Null when unknown. */
export async function firecrawlCredits(): Promise<number | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch(`${FIRECRAWL_BASE}/team/credit-usage`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { remainingCredits?: number } };
    return typeof body.data?.remainingCredits === "number" ? body.data.remainingCredits : null;
  } catch {
    return null;
  }
}

export type SiteLink = { url: string; title?: string; description?: string };

/**
 * Lists a site's URLs (sitemap + discovered links) without reading them —
 * 1 credit, ~8s for waters.com's 497 links. The caller decides which pages
 * are worth a scrape; this only says what exists.
 */
export async function mapSite(url: string, options: { limit?: number } = {}): Promise<SiteLink[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new ScrapeError("FIRECRAWL_API_KEY is not set.", true);
  let response: Response;
  try {
    response = await fetch(`${FIRECRAWL_BASE}/map`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, limit: options.limit ?? 1000 }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ScrapeError(
      timedOut ? "Listing the site's pages took too long." : "Firecrawl could not be reached (network error).",
      true,
    );
  }
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    links?: (string | SiteLink)[];
  };
  if (!response.ok || payload.success === false) {
    const { message, retryable } = describeFirecrawlFailure(
      response.ok ? 500 : response.status,
      typeof payload.error === "string" ? payload.error : "",
    );
    throw new ScrapeError(message, retryable, response.status);
  }
  return (payload.links ?? [])
    .map((link) => (typeof link === "string" ? { url: link } : link))
    .filter((link): link is SiteLink => typeof link?.url === "string");
}
