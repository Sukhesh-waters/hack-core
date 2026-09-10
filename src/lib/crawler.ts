import crypto from "node:crypto";

export type CrawlPageResult = {
  url: string;
  title: string;
  content: string;
  contentHash: string;
  depth: number;
  /** Structured metadata extracted from JSON-LD and OG meta tags. */
  structured: StructuredMeta;
  /** ETag from the server response (if any) — used for conditional re-fetches. */
  etag: string | null;
};

export type StructuredMeta = {
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogType: string | null;
  jsonLd: unknown[] | null;
};

export type CrawlOptions = {
  maxPages?: number;
  maxDepth?: number;
  timeoutMs?: number;
  /** Max parallel fetches per domain. Default: 2 (polite crawling). */
  concurrency?: number;
  /** ETags from previous crawl for conditional re-fetch. Map<url, etag>. */
  previousEtags?: Map<string, string>;
};

const USER_AGENT = "InstaMedia-BrandGeneCrawler/1.0";

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  const baseDomain = new URL(baseUrl).hostname;

  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl);
      if (resolved.hostname === baseDomain && ["http:", "https:"].includes(resolved.protocol)) {
        // Strip fragment
        resolved.hash = "";
        links.push(resolved.href);
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  return Array.from(new Set(links));
}

function extractTitleAndText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Untitled";

  // Strip script, style tags, and HTML comments
  const cleanHtml = html
    .replace(/<script\b[^<]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^<]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Strip HTML tags
  const text = cleanHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { title, text };
}

/**
 * Extract structured metadata from HTML (OG meta tags and JSON-LD).
 */
function extractStructuredMeta(html: string): StructuredMeta {
  const og = (property: string): string | null => {
    const match = html.match(
      new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    );
    return match?.[1] ?? null;
  };

  // Extract JSON-LD blocks
  const jsonLdBlocks: unknown[] = [];
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      jsonLdBlocks.push(JSON.parse(jsonMatch[1]));
    } catch {
      // Skip malformed JSON-LD
    }
  }

  return {
    ogTitle: og("title"),
    ogDescription: og("description"),
    ogImage: og("image"),
    ogType: og("type"),
    jsonLd: jsonLdBlocks.length > 0 ? jsonLdBlocks : null,
  };
}

/**
 * Fetch and parse robots.txt for a domain. Returns a set of disallowed paths.
 */
async function fetchDisallowedPaths(
  baseUrl: string,
  timeoutMs: number,
): Promise<Set<string>> {
  const disallowed = new Set<string>();
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timer);

    if (!response.ok) return disallowed;
    const text = await response.text();

    let isRelevantAgent = false;
    for (const line of text.split("\n")) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith("user-agent:")) {
        const agent = trimmed.slice("user-agent:".length).trim();
        isRelevantAgent = agent === "*" || agent.includes("instamedia");
      } else if (isRelevantAgent && trimmed.startsWith("disallow:")) {
        const path = trimmed.slice("disallow:".length).trim();
        if (path) disallowed.add(path);
      }
    }
  } catch {
    // robots.txt unavailable — allow all
  }
  return disallowed;
}

/**
 * Fetch and parse ai.txt for a domain. Returns true if AI crawling is blocked.
 */
async function isAiCrawlingBlocked(
  baseUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const aiTxtUrl = new URL("/ai.txt", baseUrl).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(aiTxtUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timer);

    if (!response.ok) return false; // No ai.txt → allowed
    const text = await response.text();

    // Simple check: if ai.txt contains "Disallow: /" or "User-Agent: *" + "Disallow"
    // for our agent, respect it
    const lines = text.toLowerCase().split("\n");
    for (const line of lines) {
      if (line.includes("disallow") && line.includes("/")) {
        return true;
      }
    }
  } catch {
    // ai.txt unavailable — allowed
  }
  return false;
}

/**
 * Fetch sitemap.xml URLs for priority crawling.
 */
async function fetchSitemapUrls(
  baseUrl: string,
  timeoutMs: number,
  maxUrls: number,
): Promise<string[]> {
  const urls: string[] = [];
  try {
    const sitemapUrl = new URL("/sitemap.xml", baseUrl).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(sitemapUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timer);

    if (!response.ok) return urls;
    const xml = await response.text();

    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    let locMatch: RegExpExecArray | null;
    while ((locMatch = locRegex.exec(xml)) !== null && urls.length < maxUrls) {
      urls.push(locMatch[1].trim());
    }
  } catch {
    // sitemap unavailable — fall back to BFS
  }
  return urls;
}

/**
 * Simple concurrency limiter for polite crawling.
 */
function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      while (active >= maxConcurrent) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
        const next = queue.shift();
        if (next) next();
      }
    },
  };
}

function isPathDisallowed(url: string, disallowed: Set<string>): boolean {
  try {
    const { pathname } = new URL(url);
    for (const path of disallowed) {
      if (pathname.startsWith(path)) return true;
    }
  } catch {
    // Invalid URL — treat as disallowed
    return true;
  }
  return false;
}

/**
 * F2 · Enhanced internal crawler for Brand Gene.
 * Same-domain BFS crawler with:
 * - robots.txt + ai.txt compliance
 * - Sitemap.xml priority crawl (hits high-value pages first)
 * - ETag conditional fetch (skip unchanged pages)
 * - Structured data extraction (JSON-LD, OG meta tags)
 * - Concurrency limiter (default: 2 parallel fetches)
 * - SHA-256 content hashing for deduplication
 */
export async function crawlDomain(
  startUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlPageResult[]> {
  const maxPages = options.maxPages ?? 25;
  const maxDepth = options.maxDepth ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const concurrency = options.concurrency ?? 2;
  const previousEtags = options.previousEtags ?? new Map<string, string>();

  // Pre-flight compliance checks
  const [disallowed, aiBlocked] = await Promise.all([
    fetchDisallowedPaths(startUrl, timeoutMs),
    isAiCrawlingBlocked(startUrl, timeoutMs),
  ]);

  if (aiBlocked) {
    // Site explicitly blocks AI crawlers — respect it
    return [];
  }

  // Seed queue: sitemap URLs first (priority), then start URL
  const sitemapUrls = await fetchSitemapUrls(startUrl, timeoutMs, maxPages);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];

  // Sitemap URLs get depth=1 (discovered from sitemap, not BFS)
  for (const sUrl of sitemapUrls) {
    if (!isPathDisallowed(sUrl, disallowed)) {
      queue.push({ url: sUrl, depth: 1 });
    }
  }
  // Start URL always goes first
  queue.unshift({ url: startUrl, depth: 0 });

  const results: CrawlPageResult[] = [];
  const limiter = createConcurrencyLimiter(concurrency);

  while (queue.length > 0 && results.length < maxPages) {
    const item = queue.shift();
    if (!item) break;
    const { url, depth } = item;

    if (visited.has(url) || depth > maxDepth) continue;
    if (isPathDisallowed(url, disallowed)) continue;
    visited.add(url);

    try {
      const page = await limiter.run(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const headers: Record<string, string> = { "User-Agent": USER_AGENT };
        const prevEtag = previousEtags.get(url);
        if (prevEtag) {
          headers["If-None-Match"] = prevEtag;
        }

        const response = await fetch(url, {
          signal: controller.signal,
          headers,
        });
        clearTimeout(timer);

        // 304 Not Modified — page unchanged, skip
        if (response.status === 304) return null;
        if (!response.ok) return null;

        const html = await response.text();
        const etag = response.headers.get("etag");
        const { title, text } = extractTitleAndText(html);
        const contentHash = hashContent(text);
        const structured = extractStructuredMeta(html);

        // Discover links for BFS
        if (depth < maxDepth) {
          const links = extractLinks(html, url);
          for (const link of links) {
            if (!visited.has(link) && !isPathDisallowed(link, disallowed)) {
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        }

        return {
          url,
          title,
          content: text,
          contentHash,
          depth,
          structured,
          etag,
        };
      });

      if (page) {
        results.push(page);
      }
    } catch {
      // Aborted or network failure — skip silently
    }
  }

  return results;
}
