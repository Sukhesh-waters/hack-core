/**
 * Source derivation for a new client (core spine S2). Pure and deterministic:
 * the same brand always yields the same candidates in the same order, with no
 * network and no clock. The operator edits this list; nothing here is fetched
 * until they approve it.
 */
import type {
  PlatinaBrandHandles,
  PlatinaScanTarget,
} from "@/db/platina-schema";

export type SourceConfidence = "certain" | "likely" | "guess";

export type SourceCandidate = {
  /** Stable key: same candidate, same id, across renders. */
  id: string;
  kind: PlatinaScanTarget["kind"];
  /** Absolute URL, or "<platform>:@handle" for social kinds. */
  value: string;
  cadenceMinutes: number;
  /** Plain language, shown next to the checkbox. */
  reason: string;
  confidence: SourceConfidence;
  /** Pages/posts per run. */
  maxPages: number;
  /**
   * Discovery aids (sitemap, robots) are probed for existence but are never a
   * content source — a sitemap XML is not a page worth analysing. Their result
   * seeds the homepage crawl instead.
   */
  discovery?: boolean;
};

export const DEFAULT_CADENCE_MINUTES = 15;
/** The ad-library actor bills a 10-result minimum, so never ask for fewer. */
export const AD_RESULTS_PER_RUN = 10;
const HOMEPAGE_PAGES = 5;
const SECTION_PAGES = 3;
const POSTS_PER_RUN = 10;

/** Path candidates worth checking, in a fixed order. */
const SECTION_PATHS: {
  path: string;
  kind: PlatinaScanTarget["kind"];
  reason: string;
  discovery?: boolean;
}[] = [
  { path: "/sitemap.xml", kind: "competitor_site", reason: "Lets us crawl the pages the site itself lists.", discovery: true },
  { path: "/sitemap_index.xml", kind: "competitor_site", reason: "The site's index of sitemaps.", discovery: true },
  { path: "/robots.txt", kind: "competitor_site", reason: "Tells us what the site allows.", discovery: true },
  { path: "/news", kind: "press_release", reason: "A news page — the usual home of announcements." },
  { path: "/press", kind: "press_release", reason: "A press page." },
  { path: "/newsroom", kind: "press_release", reason: "A newsroom page." },
  { path: "/blog", kind: "trade_editorial", reason: "A blog — editorial and thought leadership." },
  { path: "/feed", kind: "trade_editorial", reason: "A content feed, if the site publishes one." },
  { path: "/rss.xml", kind: "trade_editorial", reason: "An RSS feed, if the site publishes one." },
  { path: "/atom.xml", kind: "trade_editorial", reason: "An Atom feed, if the site publishes one." },
];

/** "acme.com", "http://acme.com/x?y" -> "https://acme.com" (origin only). Null if unusable. */
export function normalizeHomepage(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.includes(".")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** LinkedIn company collection: weekly, 10 posts (~$0.02 a run). */
export const LINKEDIN_CADENCE_MINUTES = 7 * 24 * 60;
export const LINKEDIN_POSTS_PER_RUN = 10;

/**
 * A LinkedIn company page from a slug ("waters"), "@waters", or its URL
 * ("https://www.linkedin.com/company/waters/posts"). Null for anything else —
 * including a person's /in/ profile, which is not collected.
 */
export function normalizeLinkedInCompany(input: string | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const fromUrl = /linkedin\.com\/company\/([A-Za-z0-9._-]+)/i.exec(raw);
  if (!fromUrl && /linkedin\.com|\//i.test(raw)) return null; // a person's /in/ page, or junk
  const slug = fromUrl ? fromUrl[1] : raw.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{2,80}$/.test(slug) ? slug.toLowerCase() : null;
}

/** "@Acme", " acme " -> "acme". Empty and impossible handles -> null. */
export function normalizeHandle(input: string | undefined): string | null {
  const handle = (input ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,40}$/.test(handle) ? handle : null;
}

/**
 * The public ad library, searched by brand name (R9 — campaign research).
 *
 * A competitor's site says what it claims; its live ads say what it is
 * actually spending money to say this week, which is the closer read on a
 * campaign. This is DATA — an operator-approved source value fetched through
 * Apify like every other target — not a call site, so the boundary rule holds
 * (see boundary.test.ts on operator-chosen source URLs).
 */
const AD_LIBRARY_SEARCH =
  "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&search_type=keyword_unordered&media_type=all&q=";

export function adLibrarySearch(brandName: string): string | null {
  const term = brandName.replace(/\s+/g, " ").trim();
  if (term.length < 2) return null;
  return `${AD_LIBRARY_SEARCH}${encodeURIComponent(term)}`;
}

export function deriveSources(input: {
  homepageUrl: string;
  handles: PlatinaBrandHandles;
  /** Enables the ad-library candidate, which is searched by name. */
  brandName?: string;
}): SourceCandidate[] {
  const origin = normalizeHomepage(input.homepageUrl);
  const out: SourceCandidate[] = [];

  if (origin) {
    out.push({
      id: `competitor_site:${origin}`,
      kind: "competitor_site",
      value: origin,
      cadenceMinutes: DEFAULT_CADENCE_MINUTES,
      reason: "The main website.",
      confidence: "certain",
      maxPages: HOMEPAGE_PAGES,
    });
    for (const section of SECTION_PATHS) {
      const value = `${origin}${section.path}`;
      out.push({
        id: `${section.kind}:${value}`,
        kind: section.kind,
        value,
        cadenceMinutes: DEFAULT_CADENCE_MINUTES,
        reason: section.reason,
        confidence: "guess",
        maxPages: SECTION_PAGES,
        ...(section.discovery ? { discovery: true } : {}),
      });
    }
  }

  for (const platform of ["instagram", "tiktok"] as const) {
    const handle = normalizeHandle(input.handles[platform]);
    if (!handle) continue;
    const value = `${platform}:@${handle}`;
    out.push(
      {
        id: `social_profile:${value}`,
        kind: "social_profile",
        value,
        cadenceMinutes: DEFAULT_CADENCE_MINUTES,
        reason: `The ${platform} profile: bio and follower count.`,
        confidence: "certain",
        maxPages: 1,
      },
      {
        id: `social_posts:${value}`,
        kind: "social_posts",
        value,
        cadenceMinutes: DEFAULT_CADENCE_MINUTES,
        reason: `Recent ${platform} posts and how they performed.`,
        confidence: "certain",
        maxPages: POSTS_PER_RUN,
      },
    );
  }

  const linkedin = normalizeLinkedInCompany(input.handles.linkedin);
  if (linkedin) {
    out.push({
      id: `social_posts:linkedin:@${linkedin}`,
      kind: "social_posts",
      value: `linkedin:@${linkedin}`,
      cadenceMinutes: LINKEDIN_CADENCE_MINUTES,
      reason:
        "LinkedIn company posts and how people engaged with them — the audience's interest, topic by topic.",
      confidence: "certain",
      maxPages: LINKEDIN_POSTS_PER_RUN,
    });
  }

  const ads = input.brandName ? adLibrarySearch(input.brandName) : null;
  if (ads) {
    out.push({
      id: `ad_library:${input.brandName}`,
      kind: "ad_library",
      value: ads,
      // Ads move on campaign cadence, not page cadence, and the actor bills a
      // 10-result minimum per run — so this runs daily, not every 15 minutes.
      cadenceMinutes: 24 * 60,
      reason:
        "Live ads in the public ad library — what they are paying to say right now, not just what their site claims.",
      confidence: "guess",
      maxPages: AD_RESULTS_PER_RUN,
    });
  }
  return out;
}

/** The operator's approved candidates -> one scan-spec draft each (1 target per spec). */
export type SpecDraft = {
  name: string;
  cadenceMinutes: number;
  targets: PlatinaScanTarget[];
};

export const MAX_SOURCES_PER_APPROVAL = 25;

export function candidatesToSpecs(
  brandName: string,
  approved: SourceCandidate[],
  sitemapFound: boolean,
): SpecDraft[] {
  const seen = new Set<string>();
  const drafts: SpecDraft[] = [];
  for (const c of approved) {
    if (c.discovery || seen.has(c.id)) continue;
    seen.add(c.id);
    const isHomepage =
      c.kind === "competitor_site" && new URL(c.value).pathname === "/";
    drafts.push({
      name: `${brandName} · ${labelFor(c)}`,
      cadenceMinutes: c.cadenceMinutes,
      targets: [
        {
          kind: c.kind,
          value: c.value,
          maxPages: c.maxPages,
          ...(isHomepage && sitemapFound ? { seedFromSitemap: true } : {}),
        },
      ],
    });
  }
  return drafts.slice(0, MAX_SOURCES_PER_APPROVAL);
}

function labelFor(c: SourceCandidate): string {
  if (c.kind === "social_profile") return `${c.value.split(":")[0]} profile`;
  if (c.kind === "social_posts") return `${c.value.split(":")[0]} posts`;
  // The ad-library URL's path is "/ads/library/" — a name nobody wants to read.
  if (c.kind === "ad_library") return "ads";
  try {
    const path = new URL(c.value).pathname;
    return path === "/" ? "website" : path.replace(/^\/|\/$/g, "");
  } catch {
    return c.value;
  }
}
