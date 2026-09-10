import type { HarnessSegment } from "@/db/schema";
import type { ActorKey } from "@/lib/connectors/apify-actors";

/**
 * Pure planners for the Apify harness layer. The impure runner
 * (src/inngest/functions/pattern-scan.ts) stays thin — everything decidable
 * without I/O lives here, fully unit-tested.
 */

/** Budget cap: per-run post count, hard-limited regardless of config. */
export const HARNESS_HARD_CAP = 100;
export const HARNESS_DEFAULT_CAP = 30;

/** Hard cap for comments per run. */
export const COMMENTS_HARD_CAP = 100;
export const COMMENTS_PER_POST_CAP = 20;
export const COMMENTS_TOP_POSTS = 5;

export function clampCap(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) {
    return HARNESS_DEFAULT_CAP;
  }
  return Math.min(Math.floor(requested), HARNESS_HARD_CAP);
}

function hashtagify(value: string): string {
  return value
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Determine which actor to use for a segment (A2: reels routing).
 * - competitor_handle + target=reels → "reels"
 * - hashtag + target=reels → "reels"
 * - everything else → "posts"
 */
export function actorKeyForSegment(segment: HarnessSegment): ActorKey {
  if (segment.kind === "tiktok_handle") return "tiktok_posts";
  if (segment.kind === "ad_library_page") return "ad_library";
  if (segment.target === "reels") return "reels";
  return "posts";
}

/**
 * Map a segment to actor input params (Apify actors only — constitution).
 * resultsLimit is applied by the caller via clampCap.
 *
 * The reel scraper takes username[], NOT directUrls (unlike the posts
 * scraper) — A2 routing must branch on target or every reels segment for a
 * competitor_handle gets sent with no username/hashtags and 400s.
 */
export function segmentToActorInput(
  segment: HarnessSegment,
): Record<string, unknown> {
  const isReels = segment.target === "reels";
  switch (segment.kind) {
    case "competitor_handle": {
      const handle = segment.value.replace(/^@/, "");
      return isReels
        ? { username: [handle] }
        : { directUrls: [`https://www.instagram.com/${handle}/`] };
    }
    case "hashtag":
      return {
        hashtags: [hashtagify(segment.value)],
      };
    case "niche_query":
      // No search API on the actor — a niche query becomes its closest hashtag
      return {
        hashtags: [hashtagify(segment.value)],
      };
    case "tiktok_handle": {
      const handle = segment.value.replace(/^@/, "");
      return { profiles: [handle] };
    }
    case "ad_library_page":
      return { searchTerms: [segment.value] };
    case "website_url":
      // Website URLs are handled by the internal crawler, not Apify.
      // Return empty input — the caller should route to crawlDomain instead.
      return { url: segment.value };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Is a scheduled (cron) run due? Manual cadence never auto-runs. */
export function nextRunDue(
  rule: {
    enabled: boolean;
    cadence: "manual" | "daily" | "weekly";
    lastRunAt: Date | null;
  },
  now: Date,
): boolean {
  if (!rule.enabled || rule.cadence === "manual") return false;
  if (!rule.lastRunAt) return true;
  const interval = rule.cadence === "daily" ? DAY_MS : 7 * DAY_MS;
  return now.getTime() - rule.lastRunAt.getTime() >= interval;
}

/**
 * Dedupe scraped items against external post ids the workspace already has
 * (and within the batch itself). Items without an external id are kept —
 * they can't collide deterministically.
 */
export function dedupeItems<T extends { externalId?: string }>(
  items: T[],
  existingExternalIds: Iterable<string>,
): T[] {
  const seen = new Set(existingExternalIds);
  const out: T[] = [];
  for (const item of items) {
    if (item.externalId) {
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
    }
    out.push(item);
  }
  return out;
}

/**
 * Should we fetch a profile snapshot for this handle today?
 * Dedupes against the most recent snapshot date.
 */
export function profileFetchDue(
  lastTakenAt: Date | null,
  now: Date,
): boolean {
  if (!lastTakenAt) return true;
  return now.getTime() - lastTakenAt.getTime() >= DAY_MS;
}

/**
 * Extract unique competitor handles from a segment list.
 */
export function extractCompetitorHandles(
  segments: HarnessSegment[],
): string[] {
  const handles = new Set<string>();
  for (const seg of segments) {
    if (seg.kind === "competitor_handle") {
      handles.add(seg.value.replace(/^@/, ""));
    }
  }
  return [...handles];
}

/**
 * Pick top N posts by likes for comment mining.
 */
export function pickTopPostsForComments<
  T extends { likes?: number; externalId?: string },
>(posts: T[], n: number = COMMENTS_TOP_POSTS): T[] {
  return [...posts]
    .filter((p) => p.externalId)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, n);
}

/**
 * Check if any segment in the list has comment mining enabled.
 */
export function hasCommentMining(segments: HarnessSegment[]): boolean {
  return segments.some((s) => s.mineComments === true);
}
