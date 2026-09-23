/**
 * Public pattern ingestion via Apify actors (constitution: Apify actors only —
 * no own-scraper pipelines). Output lands ONLY in pattern_posts / pattern_profiles /
 * pattern_comments (source=public, weight neutral).
 *
 * Refactored in A1 to use the multi-actor registry (apify-actors.ts).
 * Backward-compatible: fetchPublicPosts and runSegment still work exactly as before.
 */

import type { HarnessSegment } from "@/db/schema";
import { clampCap, segmentToActorInput, actorKeyForSegment } from "@/lib/harness";
import {
  type ActorKey,
  type PatternPostItem,
  type PatternProfileItem,
  type PatternCommentItem,
  resolveActorSlug,
  getActorEntry,
  postsActor,
  profileActor,
  commentsActor,
} from "./apify-actors";
import { isCallAllowed, recordSuccess, recordFailure } from "./circuit-breaker";

const BASE_URL = "https://api.apify.com/v2/acts";

export class ApifyError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

// Re-export for backward compatibility — existing code imports PatternItem from here
export type PatternItem = PatternPostItem;

/**
 * Low-level actor runner. Calls the Apify run-sync-get-dataset-items endpoint
 * for a given actor key with the provided input, then maps the raw output
 * through the registry's mapper.
 */
async function runActor<T>(
  key: ActorKey,
  input: Record<string, unknown>,
): Promise<T[]> {
  if (!isCallAllowed(key)) {
    throw new ApifyError(
      `Circuit breaker open for actor "${key}" — call blocked to save credits`,
    );
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new ApifyError("APIFY_TOKEN is not set");

  const slug = resolveActorSlug(key);
  const url = `${BASE_URL}/${slug}/run-sync-get-dataset-items`;

  try {
    const response = await fetch(url, {
      method: "POST",
      // The token travels in a header, never the URL (URLs end up in logs).
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      recordFailure(key);
      throw new ApifyError(
        `Apify run failed (${response.status})`,
        response.status,
      );
    }

    const items = await response.json();
    if (!Array.isArray(items)) {
      recordFailure(key);
      throw new ApifyError("Apify returned an unexpected payload");
    }

    const entry = getActorEntry(key);
    const result = entry.mapOutput(items) as T[];
    recordSuccess(key);
    return result;
  } catch (error) {
    if (error instanceof ApifyError) throw error;
    recordFailure(key);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public API — backward-compatible functions
// ---------------------------------------------------------------------------

export async function fetchPublicPosts(
  handle: string,
  limit = 30,
): Promise<PatternPostItem[]> {
  const input = postsActor.buildInput({
    directUrls: [`https://www.instagram.com/${handle.replace(/^@/, "")}/`],
    resultsLimit: limit,
  });
  return runActor<PatternPostItem>("posts", input);
}

/**
 * Harness runner (Slice E): one segment → one capped actor run. Segment
 * kinds and targets map via the registry; the cap is clamped to the hard budget.
 */
export async function runSegment(
  segment: HarnessSegment,
  cap: number,
): Promise<PatternPostItem[]> {
  const key = actorKeyForSegment(segment);
  const entry = getActorEntry(key);
  const input = entry.buildInput({
    ...segmentToActorInput(segment),
    resultsLimit: clampCap(cap),
  });
  return runActor<PatternPostItem>(key, input);
}

// ---------------------------------------------------------------------------
// New multi-actor functions (A3, A4)
// ---------------------------------------------------------------------------

/** Fetch profile snapshot for one or more handles. */
export async function fetchProfiles(
  handles: string[],
): Promise<PatternProfileItem[]> {
  const input = profileActor.buildInput({
    usernames: handles.map((h) => h.replace(/^@/, "")),
  });
  return runActor<PatternProfileItem>("profile", input);
}

/** Fetch comments for a post by its Instagram URL. */
export async function fetchComments(
  postUrl: string,
  limit = 20,
): Promise<PatternCommentItem[]> {
  const input = commentsActor.buildInput({
    directUrls: [postUrl],
    resultsLimit: limit,
  });
  return runActor<PatternCommentItem>("comments", input);
}
