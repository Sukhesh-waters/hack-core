/**
 * Sitemap reading for source discovery (onboarding). A sitemap is site
 * metadata — a list of URLs and their last-modified dates — not page content,
 * which is why own code may read it (constitution: header/metadata probes are
 * permitted; content retrieval stays Apify-only). Nothing here fetches a page.
 *
 * Instead of guessing "/blog" and "/news", this reports which sections the site
 * actually publishes, how many pages each has, and when each last changed.
 * Pure parsing plus an injected text fetch, so it is unit-testable and names no
 * host.
 */
import type { PlatinaScanTarget } from "@/db/platina-schema";
import {
  DEFAULT_CADENCE_MINUTES,
  type SourceCandidate,
} from "./derive";
import type { Discovered } from "./discover";

export type SitemapEntry = { loc: string; lastmod: string | null };

export const MAX_SITEMAP_ENTRIES = 5000;
/** A section must have at least this many pages to be worth watching. */
export const MIN_SECTION_PAGES = 3;
const MAX_ADDED_SECTIONS = 4;
const MAX_CHILD_SITEMAPS = 2;

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decode(m[1]) : null;
}

/** Reads <url> entries and <sitemap> children. Malformed input yields empty lists. */
export function parseSitemap(xml: string): {
  entries: SitemapEntry[];
  childSitemaps: string[];
} {
  const entries: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = tag(m[1], "loc");
    if (loc) entries.push({ loc, lastmod: tag(m[1], "lastmod") });
    if (entries.length >= MAX_SITEMAP_ENTRIES) break;
  }
  const childSitemaps: string[] = [];
  for (const m of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = tag(m[1], "loc");
    if (loc) childSitemaps.push(loc);
  }
  return { entries, childSitemaps };
}

export type Section = { path: string; count: number; lastmod: string | null };

const LOCALE = /^[a-z]{2}(-[a-z]{2})?$/i;

/** First path segment (after an optional locale) -> page count and newest lastmod. */
export function sectionsFromSitemap(entries: SitemapEntry[], origin: string): Section[] {
  const groups = new Map<string, Section>();
  for (const e of entries) {
    let url: URL;
    try {
      url = new URL(e.loc);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 0 && LOCALE.test(segments[0])) segments.shift();
    // A page directly under a section counts; the bare root and deep noise do not.
    if (segments.length < 2) continue;
    const path = `/${segments[0]}`;
    const g = groups.get(path) ?? { path, count: 0, lastmod: null };
    g.count += 1;
    if (e.lastmod && (!g.lastmod || e.lastmod > g.lastmod)) g.lastmod = e.lastmod;
    groups.set(path, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.path.localeCompare(b.path),
  );
}

type WatchKind = Extract<
  PlatinaScanTarget["kind"],
  "press_release" | "trade_editorial" | "conference"
>;

/** Only sections whose name says what they are; anything else is skipped, not guessed. */
export function kindForSection(path: string): WatchKind | null {
  const name = path.slice(1).toLowerCase();
  if (/^(news|press|media|newsroom|announcements|press-releases?)$/.test(name)) {
    return "press_release";
  }
  if (/^(blog|insights|articles|resources|stories|perspectives|thought-leadership)$/.test(name)) {
    return "trade_editorial";
  }
  if (/^(events?|webinars?|conferences?)$/.test(name)) return "conference";
  return null;
}

const WATCH_KINDS: readonly string[] = ["press_release", "trade_editorial", "conference"];

/**
 * Re-creates a sitemap-found candidate from its id ("<kind>:<url>") so the
 * approval step can honour it without trusting the form: the URL must be on
 * the client's own origin, at most one path segment deep, with no query.
 */
export function candidateFromId(id: string, homepageOrigin: string): SourceCandidate | null {
  const at = id.indexOf(":");
  if (at < 0) return null;
  const kind = id.slice(0, at);
  const value = id.slice(at + 1);
  if (!WATCH_KINDS.includes(kind)) return null;
  try {
    const url = new URL(value);
    if (url.origin !== homepageOrigin || url.search || url.hash) return null;
    if (url.pathname.split("/").filter(Boolean).length !== 1) return null;
  } catch {
    return null;
  }
  return {
    id,
    kind: kind as WatchKind,
    value,
    cadenceMinutes: DEFAULT_CADENCE_MINUTES,
    reason: "Found in the site's own sitemap.",
    confidence: "likely",
    maxPages: 3,
  };
}

export type FetchText = (url: string) => Promise<string | null>;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/**
 * Folds what the sitemap says into the discovery list: guessed sections that
 * really exist are confirmed with real page counts, and real sections the
 * guesses missed are added (at most a few). Never throws — a failed or odd
 * sitemap just leaves the list as it was.
 */
export async function enrichFromSitemap(
  found: Discovered[],
  origin: string,
  fetchText: FetchText,
): Promise<Discovered[]> {
  try {
    const sitemap = found.find(
      (c) => c.discovery && c.exists === true && /sitemap(_index)?\.xml$/.test(c.value),
    );
    if (!sitemap) return found;

    const root = await fetchText(sitemap.value);
    if (!root) return found;
    const parsed = parseSitemap(root);
    let entries = parsed.entries;
    for (const child of parsed.childSitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
      try {
        if (new URL(child).origin !== origin) continue;
      } catch {
        continue;
      }
      const text = await fetchText(child);
      if (text) entries = entries.concat(parseSitemap(text).entries).slice(0, MAX_SITEMAP_ENTRIES);
    }

    const sections = sectionsFromSitemap(entries, origin).filter(
      (s) => s.count >= MIN_SECTION_PAGES,
    );
    const reasonFor = (s: Section) =>
      `${s.count} pages in the sitemap${s.lastmod ? `, last updated ${day(s.lastmod)}` : ""}.`;

    const byValue = new Map(found.map((c) => [c.value, c] as const));
    const out = found.map((c) => {
      const s = sections.find((x) => `${origin}${x.path}` === c.value);
      return s && !c.discovery
        ? { ...c, exists: true, confidence: "likely" as const, reason: reasonFor(s) }
        : c;
    });

    let added = 0;
    for (const s of sections) {
      const value = `${origin}${s.path}`;
      const kind = kindForSection(s.path);
      if (!kind || byValue.has(value) || added >= MAX_ADDED_SECTIONS) continue;
      out.push({
        id: `${kind}:${value}`,
        kind,
        value,
        cadenceMinutes: DEFAULT_CADENCE_MINUTES,
        reason: reasonFor(s),
        confidence: "likely",
        maxPages: 3,
        exists: true,
      });
      added += 1;
    }
    return out;
  } catch {
    return found;
  }
}
