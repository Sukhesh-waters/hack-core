/**
 * Whole-site knowledge ingest: map the site, pick the pages that describe the
 * business, read them, and chunk them by section.
 *
 * Why it exists (2026-09-21): pasting waters.com yielded 3 chunks. Not a bug —
 * the old flow read exactly the URL pasted, and a corporate homepage is a
 * thin page (~2,600 characters of real text once navigation and link syntax
 * are gone). What a brand vault needs lives one click deeper: about, products,
 * solutions, industries, news.
 *
 * What the site map looks like in practice (waters.com, live): 497 URLs, of
 * which 438 were an Australian locale, the rest product SKUs, PDFs, sitemaps,
 * careers and legal pages, and Chinese/French versions of the same pages.
 * So page PICKING is the real work, and it is pure and tested here.
 *
 * Cost: 1 credit to map + 1 per page read (markdown only). Default 8 pages
 * plus the pasted one = ~10 credits a site.
 */
import { MAX_CHUNK_CHARS, markdownToText } from "@/lib/knowledge-ingest";

export const DEFAULT_SITE_PAGES = 8;
/**
 * Pages read at once. Firecrawl's plan caps concurrent browsers (the live run
 * at 4 pushed 3 of 8 pages onto the weaker plain-fetch fallback), so 2.
 */
export const SITE_READ_CONCURRENCY = 2;

// ---------------------------------------------------------------------------
// Picking pages
// ---------------------------------------------------------------------------

const SKIP_EXTENSION = /\.(pdf|xml|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|csv|json|txt)$/i;
const SKIP_PATH =
  /(sitemap|careers?|jobs|legal|privacy|cookie|terms|login|log-in|signin|sign-in|register|account|cart|checkout|search|\/tags?\/|\/shop\/|cdn-cgi|unsubscribe|disclaimer|accessibility|\/wp-json|\/feed\b)/i;

/** Topic signals, strongest first. Matched against the URL path and title. */
const TOPIC_SCORES: [RegExp, number][] = [
  [/about|company|who-we-are|our-story|mission|values|history|leadership|overview/i, 6],
  [/products?\b|solutions?|services?|platform|offerings?|capabilit|what-we-do/i, 5],
  [/industr|markets?\b|customers?|case-stud|success-stor|(?<!library\/)applications?\b(?!-notes)/i, 4],
  [/sustainab|innovation|technolog|research|news|press|newsroom|blog|insights?/i, 3],
  [/pricing|plans?\b|contact/i, 2],
];
const DEEP_REFERENCE = /library|application-notes|primers?|education|kb_inst|knowledge-base|support\.|\/support\//i;

type Locale = { region?: string; language: string };

/**
 * The locale a URL path is written for: "/nextgen/in/en.html" -> in/en,
 * "/en-us/about" -> en-us, "/fr/produits" -> fr. Null when none is visible.
 */
export function localeOf(url: string): Locale | null {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const pair = /\/([a-z]{2})\/([a-z]{2})(?=\/|\.|$)/.exec(path);
  if (pair) return { region: pair[1], language: pair[2] };
  const dashed = /\/([a-z]{2})-([a-z]{2})(?=\/|\.|$)/.exec(path);
  if (dashed) return { language: dashed[1], region: dashed[2] };
  const single = /^\/([a-z]{2})(?=\/|$)/.exec(path);
  if (single) return { language: single[1] };
  return null;
}

/** The path with its locale removed, so /au/en/about and /us/en/about collide. */
function localeFreeKey(url: URL): string {
  return (
    url.hostname.replace(/^www\./, "") +
    url.pathname
      .toLowerCase()
      .replace(/\/[a-z]{2}\/[a-z]{2}(?=\/|\.|$)/, "")
      .replace(/\/[a-z]{2}-[a-z]{2}(?=\/|\.|$)/, "")
      .replace(/\.html?$/, "")
      .replace(/\/$/, "")
  );
}

const registrable = (host: string) => host.toLowerCase().replace(/^www\./, "");

export type PickedPage = { url: string; title?: string; score: number };

/**
 * The pages worth reading, best first. Same site (subdomains allowed — an
 * investor newsroom on ir.example.com is the brand talking), same language
 * as the page the person pasted, one version of each page, no files, no
 * legal/careers/shop noise.
 *
 * `referenceUrl` is where the pasted page actually landed (waters.com
 * redirects to /nextgen/in/en.html), because that — not the typed URL — says
 * which locale the person is working in.
 */
export function pickSitePages(input: {
  startUrl: string;
  referenceUrl?: string;
  links: { url: string; title?: string }[];
  max?: number;
}): PickedPage[] {
  const max = input.max ?? DEFAULT_SITE_PAGES;
  let site: string;
  try {
    site = registrable(new URL(input.startUrl).hostname);
  } catch {
    return [];
  }
  const reference = localeOf(input.referenceUrl ?? input.startUrl);
  const skipKeys = new Set(
    [input.startUrl, input.referenceUrl]
      .filter((u): u is string => Boolean(u))
      .flatMap((u) => {
        try {
          return [localeFreeKey(new URL(u))];
        } catch {
          return [];
        }
      }),
  );

  const best = new Map<string, PickedPage>();
  for (const link of input.links) {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const host = registrable(url.hostname);
    if (host !== site && !host.endsWith(`.${site}`)) continue;
    if (SKIP_EXTENSION.test(url.pathname) || SKIP_PATH.test(url.pathname)) continue;

    let score = 0;
    const locale = localeOf(url.href);
    if (reference && locale) {
      if (locale.language !== reference.language) continue; // another language
      if (locale.region !== reference.region) score -= 1.5; // same language, other market
    }

    const haystack = `${url.pathname} ${link.title ?? ""}`;
    const topic = TOPIC_SCORES.find(([re]) => re.test(haystack));
    score += topic ? topic[1] : 0;
    if (DEEP_REFERENCE.test(url.href)) score -= 3;
    if (/\/(19|20)\d{2}\//.test(url.pathname)) score -= 1;
    const depth = url.pathname.split("/").filter(Boolean).length - (locale ? 2 : 0);
    score -= Math.max(0, depth - 2) * 0.75;
    if (link.title) score += 0.5;

    const key = localeFreeKey(url);
    if (skipKeys.has(key)) continue;
    const existing = best.get(key);
    const candidate = { url: url.href, title: link.title, score };
    if (!existing || candidate.score > existing.score) best.set(key, candidate);
  }

  return [...best.values()]
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Chunking by section
// ---------------------------------------------------------------------------

const CTA_LINE =
  /^(learn more|read more|shop now|view all|see all|explore|explore more|contact us|download|watch (the )?video|register( now)?|find out more|get started|sign up)[.!]?$/i;

/** Normalised paragraph identity, for cross-page boilerplate removal. */
const fingerprint = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Splits a page's markdown into chunks that each carry their context:
 *
 *   "Waters › Products › Empower CDS\n\n<text of that section>"
 *
 * Retrieval matches a question against a chunk; a chunk that says which page
 * and section it came from matches "what does Waters sell for chromatography
 * data?" far better than an anonymous paragraph. Sections are packed up to
 * MAX_CHUNK_CHARS; an oversized paragraph is hard-split.
 *
 * `seen` is shared across the pages of one site ingest: a paragraph already
 * stored from another page (a repeated banner, a shared footer blurb) is not
 * stored again. Short paragraphs are exempt — a product name can repeat
 * legitimately.
 */
export function chunkMarkdown(
  markdown: string,
  pageTitle: string | null,
  seen: Set<string> = new Set(),
  maxChars: number = MAX_CHUNK_CHARS,
): string[] {
  const title = (pageTitle ?? "").split(/\s+[|–—:-]\s+/)[0].trim() || null;
  const headings: string[] = [];
  const units: { context: string; text: string }[] = [];

  for (const block of markdown.split(/\n{2,}/)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(block.trim());
    const headingText = heading ? markdownToText(heading[2]).trim() : "";
    // A "heading" that is a whole sentence is a styled paragraph, not a
    // section name — it belongs in the text, not in every chunk's context.
    if (heading && !block.trim().includes("\n") && headingText.length <= 80) {
      const level = heading[1].length;
      headings.length = Math.min(headings.length, level - 1);
      headings[level - 1] = headingText;
      continue;
    }
    const text = markdownToText(heading ? headingText : block)
      .split("\n")
      .map((line) => line.replace(/^\s*[-*+•]\s+/, "").trim())
      .filter((line) => line && !CTA_LINE.test(line))
      .map((line, _i, all) => (all.length > 1 && line.length < 200 ? `• ${line}` : line))
      .join("\n")
      .trim();
    if (!text) continue;
    // A paragraph that only repeats its own heading adds nothing.
    if (fingerprint(text) === fingerprint(headings[headings.length - 1] ?? "")) continue;
    if (text.length >= 60) {
      const id = fingerprint(text);
      if (seen.has(id)) continue;
      seen.add(id);
    }
    // "Sustainability › Sustainability" says nothing twice: drop repeats.
    const path = [title, ...headings].filter(
      (part, i, all): part is string =>
        Boolean(part) && (i === 0 || fingerprint(part ?? "") !== fingerprint(all[i - 1] ?? "")),
    );
    units.push({ context: path.join(" › "), text });
  }

  const chunks: string[] = [];
  let context = "";
  let body = "";
  // The section the last packed paragraph belonged to: a section label is
  // written once when the section changes, not before every paragraph.
  let lastUnitContext = "";
  const flush = () => {
    if (body.trim()) chunks.push(context ? `${context}\n\n${body.trim()}` : body.trim());
    body = "";
    lastUnitContext = "";
  };

  for (const unit of units) {
    const budget = maxChars - unit.context.length - 2;
    let text = unit.text;
    while (text.length > budget) {
      flush();
      context = unit.context;
      const cut = text.lastIndexOf(" ", budget);
      const at = cut > budget / 2 ? cut : budget;
      body = text.slice(0, at);
      flush();
      text = text.slice(at).trim();
    }
    if (!text) continue;
    if (body && unit.context !== context && body.length + text.length > budget / 2) {
      // A new section with enough to say starts its own chunk.
      flush();
    }
    if (body && body.length + text.length + 2 > budget) flush();
    if (!body) context = unit.context;
    else if (unit.context !== lastUnitContext && unit.context !== context) {
      const sub = unit.context.split(" › ").pop();
      text = sub ? `${sub}:\n${text}` : text;
    }
    lastUnitContext = unit.context;
    body = body ? `${body}\n\n${text}` : text;
  }
  flush();
  return chunks;
}

/** Plain text (no markdown structure — the own-fetch fallback) with a context line. */
export function chunkPlainText(
  text: string,
  pageTitle: string | null,
  chunk: (t: string) => string[],
): string[] {
  const title = (pageTitle ?? "").split(/\s+[|–—:-]\s+/)[0].trim();
  return chunk(text).map((c) => (title ? `${title}\n\n${c}` : c));
}

// ---------------------------------------------------------------------------
// Reading the site
// ---------------------------------------------------------------------------

export type SitePage = { url: string; title: string | null; chunks: string[]; via: string };

export type SiteReadDeps = {
  map: (url: string) => Promise<{ url: string; title?: string }[]>;
  /** Markdown read (Firecrawl). */
  scrape: (url: string) => Promise<{ url: string; title?: string; markdown: string }>;
  /** Plain-text fallback (own fetch) for a page Firecrawl could not read. */
  readText?: (url: string) => Promise<{ title: string | null; text: string }>;
  chunkText: (text: string) => string[];
};

/** Runs `work` over `items`, at most `limit` at a time, keeping order. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Reads the pasted page and the best other pages of its site. The pasted page
 * is mandatory (its failure is the ingest's failure); every other page is
 * best-effort and a failure is reported, never fatal. The map runs alongside
 * the first read, so listing the site costs no extra wall-clock time.
 */
export async function readSite(
  startUrl: string,
  deps: SiteReadDeps,
  options: { maxPages?: number } = {},
): Promise<{
  pages: SitePage[];
  skipped: { url: string; reason: string }[];
  mapped: number;
}> {
  const seen = new Set<string>();
  const skipped: { url: string; reason: string }[] = [];

  const readOne = async (url: string, knownTitle?: string): Promise<SitePage> => {
    try {
      const page = await deps.scrape(url);
      return {
        url: page.url || url,
        title: page.title ?? knownTitle ?? null,
        chunks: chunkMarkdown(page.markdown, page.title ?? knownTitle ?? null, seen),
        via: "firecrawl",
      };
    } catch (error) {
      if (!deps.readText) throw error;
      const { title, text } = await deps.readText(url);
      return {
        url,
        title: title ?? knownTitle ?? null,
        chunks: chunkPlainText(text, title ?? knownTitle ?? null, deps.chunkText),
        via: "direct",
      };
    }
  };

  const [first, links] = await Promise.all([
    readOne(startUrl),
    deps.map(startUrl).catch((error: unknown) => {
      skipped.push({
        url: startUrl,
        reason: `could not list the site's pages: ${error instanceof Error ? error.message : String(error)}`,
      });
      return [] as { url: string; title?: string }[];
    }),
  ]);

  const picked = pickSitePages({
    startUrl,
    referenceUrl: first.url,
    links,
    max: options.maxPages ?? DEFAULT_SITE_PAGES,
  });

  const rest = await mapConcurrent(picked, SITE_READ_CONCURRENCY, async (p) => {
    try {
      return await readOne(p.url, p.title);
    } catch (error) {
      skipped.push({ url: p.url, reason: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });

  const pages = [first, ...rest.filter((p): p is SitePage => p !== null && p.chunks.length > 0)];
  return { pages, skipped, mapped: links.length };
}
