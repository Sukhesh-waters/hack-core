/**
 * Pure actor mapping for the Apify adapter (core spine S3): which actor serves
 * a target, what input it takes, and how its output normalises into signal
 * documents with engagement metrics.
 *
 * The social input/output shapes are re-expressed here on purpose instead of
 * importing InstaMedia's connectors (boundary rule, plan Decision B). Only the
 * three fields per actor that the spine reads are mapped. Field names come from
 * the actors' documented datasets — a changed upstream payload should fail a
 * fixture in actors.test.ts first, then get a new fixture, keeping the old one.
 *
 * No IO and no clock: everything here is unit-testable.
 */
import type {
  PlatinaScanTarget,
  PlatinaSignalMetrics,
} from "@/db/platina-schema";
import { canonicalizeUrl, contentHash } from "./canonical";
import type { RawSignalDoc } from "./registry";

export const MAX_PAGES_CEILING = 25;
export const DEFAULT_PAGES = 1;

const CONTENT_CRAWLER = "apify~website-content-crawler";
const AD_LIBRARY = "curious_coder~facebook-ads-library-scraper";

export type SocialPlatform = "instagram" | "tiktok";
export type SocialRef = { platform: SocialPlatform; handle: string };

export const isSocialKind = (kind: PlatinaScanTarget["kind"]) =>
  kind === "social_profile" || kind === "social_posts";

/** 1..MAX_PAGES_CEILING, whole numbers only; anything else falls to the default. */
export function clampPages(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGES;
  return Math.min(MAX_PAGES_CEILING, Math.max(1, Math.floor(requested)));
}

/**
 * Pages a target may actually use: its own budget, capped by what the spec and
 * workspace still have today. Zero means "do not run this target".
 */
export function effectivePages(
  target: Pick<PlatinaScanTarget, "maxPages">,
  remainingBudget: number | undefined,
): number {
  const wanted = clampPages(target.maxPages);
  if (remainingBudget === undefined) return wanted;
  return Math.max(0, Math.min(wanted, remainingBudget));
}

/**
 * Accepts "instagram:@acme", "tiktok:acme", or the platform's profile URL.
 * Returns null for anything else — the caller records a failure, never guesses.
 */
export function parseSocialRef(value: string): SocialRef | null {
  const tagged = /^(instagram|tiktok):@?([A-Za-z0-9._]+)$/i.exec(value.trim());
  if (tagged) {
    return {
      platform: tagged[1].toLowerCase() as SocialPlatform,
      handle: tagged[2],
    };
  }
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const first = url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "");
    if (!first) return null;
    if (host === "instagram.com") return { platform: "instagram", handle: first };
    if (host === "tiktok.com") return { platform: "tiktok", handle: first };
  } catch {
    // not a URL — fall through
  }
  return null;
}

/**
 * memoryMb is requested per run. Apify's free plan gives the whole account
 * 8 GB, and a crawler asks for 4 GB by default — so two parallel runs used the
 * lot and the rest failed with 402 (seen in production history). A cheerio
 * crawl needs far less; a rendered (playwright) crawl really needs 4 GB.
 */
export type ActorPlan = {
  actor: string;
  input: Record<string, unknown>;
  memoryMb?: number;
};

export const CHEERIO_MEMORY_MB = 1024;
export const PLAYWRIGHT_MEMORY_MB = 4096;

/** Actor + input for one target. Throws for a kind/value it cannot serve. */
export function planTarget(target: PlatinaScanTarget, pages: number): ActorPlan {
  switch (target.kind) {
    case "competitor_site":
    case "press_release":
    case "trade_editorial":
    case "conference":
      return {
        actor: CONTENT_CRAWLER,
        input: crawlerInput(target, pages),
        memoryMb: target.renderJs ? PLAYWRIGHT_MEMORY_MB : CHEERIO_MEMORY_MB,
      };
    case "ad_library":
      return {
        actor: AD_LIBRARY,
        input: {
          urls: [{ url: target.value }],
          // The actor bills a 10-result minimum, so never ask for fewer.
          count: Math.max(10, pages),
          proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
        },
      };
    case "social_profile":
    case "social_posts": {
      const ref = parseSocialRef(target.value);
      if (!ref) {
        throw new Error(
          `social source must look like instagram:@handle or tiktok:@handle, got "${target.value}"`,
        );
      }
      return socialPlan(target.kind, ref, pages);
    }
    default:
      throw new Error(
        `no actor mapped for source kind: ${(target as { kind: string }).kind}`,
      );
  }
}

function crawlerInput(target: PlatinaScanTarget, pages: number) {
  const multi = pages > 1;
  return {
    startUrls: [{ url: target.value }],
    // Depth 0 is the single-page change-detector; more pages need some reach.
    maxCrawlDepth: target.seedFromSitemap ? 1 : multi ? 2 : 0,
    maxCrawlPages: pages,
    useSitemaps: Boolean(target.seedFromSitemap),
    // Cheerio executes no JavaScript; a React shell returns empty. Rendering
    // costs ~5-10x, so it is an explicit per-source opt-in.
    crawlerType: target.renderJs ? "playwright:adaptive" : "cheerio",
  };
}

function socialPlan(
  kind: "social_profile" | "social_posts",
  ref: SocialRef,
  pages: number,
): ActorPlan {
  if (ref.platform === "instagram") {
    return kind === "social_profile"
      ? {
          actor: "apify~instagram-profile-scraper",
          input: { usernames: [ref.handle] },
        }
      : {
          actor: "apify~instagram-scraper",
          input: {
            directUrls: [`https://www.instagram.com/${ref.handle}/`],
            resultsType: "posts",
            resultsLimit: pages,
          },
        };
  }
  return {
    actor:
      kind === "social_profile"
        ? "clockworks~tiktok-profile-scraper"
        : "clockworks~tiktok-scraper",
    input: {
      profiles: [ref.handle],
      resultsPerPage: pages,
      shouldDownloadVideos: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Output mapping
// ---------------------------------------------------------------------------

/** Keeps only real measurements. -1 (hidden likes) and non-numbers are dropped. */
export function pickMetrics(
  candidates: Record<keyof Omit<PlatinaSignalMetrics, "postedAt">, unknown>,
  postedAt?: unknown,
): PlatinaSignalMetrics | undefined {
  const out: PlatinaSignalMetrics = {};
  for (const key of ["likes", "comments", "views", "shares", "followers"] as const) {
    const v = candidates[key];
    // Zero is a measurement; absence is not — never default a gap to 0.
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  if (typeof postedAt === "string" && !Number.isNaN(Date.parse(postedAt))) {
    out.postedAt = new Date(postedAt).toISOString();
  } else if (typeof postedAt === "number" && postedAt > 0) {
    // Unix seconds (TikTok createTime).
    out.postedAt = new Date(postedAt * 1000).toISOString();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

export function mapSocialItem(
  item: Record<string, unknown>,
  target: PlatinaScanTarget,
  ref: SocialRef,
): RawSignalDoc | null {
  // Actors emit an { error } / { errorDescription } item on failure — never a document.
  if (typeof item.error === "string" || typeof item.errorDescription === "string") {
    return null;
  }
  const isProfile = target.kind === "social_profile" && ref.platform === "instagram";

  const url =
    str(item.url) ?? str(item.webVideoUrl) ?? str(item.inputUrl) ?? target.value;
  const body = isProfile
    ? [str(item.fullName), str(item.biography)].filter(Boolean).join(" — ")
    : (str(item.caption) ?? str(item.text) ?? "");
  if (!body.trim()) return null;

  const author = (item.authorMeta ?? {}) as Record<string, unknown>;
  const metrics = isProfile
    ? pickMetrics(
        { likes: undefined, comments: undefined, views: undefined, shares: undefined, followers: item.followersCount },
      )
    : ref.platform === "instagram"
      ? pickMetrics(
          {
            likes: item.likesCount,
            comments: item.commentsCount,
            views: item.videoViewCount ?? item.videoPlayCount,
            shares: undefined,
            followers: undefined,
          },
          item.timestamp,
        )
      : pickMetrics(
          {
            likes: item.diggCount,
            comments: item.commentCount,
            views: item.playCount,
            shares: item.shareCount,
            followers: author.fans,
          },
          str(item.createTimeISO) ?? item.createTime,
        );

  const canonical = canonicalizeUrl(url);
  return {
    sourceUrl: target.value,
    canonicalUrl: canonical,
    title: `${ref.platform} @${ref.handle}`,
    body,
    adapter: "apify",
    sourceKind: target.kind,
    contentHash: contentHash(canonical, body),
    raw: item,
    ...(metrics ? { metrics } : {}),
  };
}
