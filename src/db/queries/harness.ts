import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessRules,
  patternComments,
  patternPosts,
  patternProfiles,
  patternRuns,
  type HarnessSegment,
} from "@/db/schema";
import type { PatternItem } from "@/lib/connectors/apify";
import type {
  PatternProfileItem,
  PatternCommentItem,
} from "@/lib/connectors/apify-actors";

export function harnessRuleQuery(workspaceId: string) {
  return db
    .select()
    .from(harnessRules)
    .where(eq(harnessRules.workspaceId, workspaceId))
    .limit(1);
}

export async function getHarnessRule(workspaceId: string) {
  const rows = await harnessRuleQuery(workspaceId);
  return rows[0] ?? null;
}

/** Insert-or-update against the one-rule-per-workspace unique index. */
export async function upsertHarnessRule(
  workspaceId: string,
  patch: {
    segments: HarnessSegment[];
    maxPostsPerRun: number;
    cadence: "manual" | "daily" | "weekly";
    enabled: boolean;
  },
) {
  await db
    .insert(harnessRules)
    .values({ workspaceId, ...patch })
    .onConflictDoUpdate({
      target: [harnessRules.workspaceId],
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function markRuleRan(ruleId: string, at: Date) {
  await db
    .update(harnessRules)
    .set({ lastRunAt: at })
    .where(eq(harnessRules.id, ruleId));
}

/** Cron sweep input — system-level like dueRemindersQuery; cadence filtering
 * happens in pure nextRunDue. */
export async function listEnabledHarnessRules() {
  return db.select().from(harnessRules).where(eq(harnessRules.enabled, true));
}

export function patternRunsQuery(workspaceId: string, limit = 20) {
  return db
    .select()
    .from(patternRuns)
    .where(eq(patternRuns.workspaceId, workspaceId))
    .orderBy(desc(patternRuns.createdAt))
    .limit(limit);
}

export async function listPatternRuns(workspaceId: string, limit = 20) {
  return patternRunsQuery(workspaceId, limit);
}

/** A5: createPatternRun now accepts an actor parameter for observability. */
export async function createPatternRun(
  workspaceId: string,
  harnessRuleId: string,
  segment: HarnessSegment,
  actor?: string,
) {
  const [row] = await db
    .insert(patternRuns)
    .values({
      workspaceId,
      harnessRuleId,
      segment,
      actor: actor ?? null,
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: patternRuns.id });
  return row.id;
}

export async function finishPatternRun(
  runId: string,
  outcome:
    | { status: "done"; postsFetched: number }
    | { status: "failed"; error: string },
) {
  await db
    .update(patternRuns)
    .set({ ...outcome, finishedAt: new Date() })
    .where(eq(patternRuns.id, runId));
}

/** Top performers by public engagement — inspiration surface input. */
export function topPatternPostsQuery(workspaceId: string, limit = 12) {
  return db
    .select()
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId))
    .orderBy(
      desc(sql`coalesce(${patternPosts.likes}, 0) + coalesce(${patternPosts.comments}, 0)`),
    )
    .limit(limit);
}

export async function listTopPatternPosts(workspaceId: string, limit = 12) {
  return topPatternPostsQuery(workspaceId, limit);
}

export function existingExternalIdsQuery(
  workspaceId: string,
  externalIds: string[],
) {
  return db
    .select({ externalId: patternPosts.externalId })
    .from(patternPosts)
    .where(
      and(
        eq(patternPosts.workspaceId, workspaceId),
        isNotNull(patternPosts.externalId),
        inArray(patternPosts.externalId, externalIds),
      ),
    );
}

export async function listExistingExternalIds(
  workspaceId: string,
  externalIds: string[],
): Promise<string[]> {
  if (externalIds.length === 0) return [];
  const rows = await existingExternalIdsQuery(workspaceId, externalIds);
  return rows.flatMap((r) => (r.externalId ? [r.externalId] : []));
}

/** Harness ingestion: pattern layer ONLY, tagged with run + segment.
 * Returns the inserted rows' internal ids keyed by externalId, so callers
 * (e.g. comment mining) can reference the real pattern_posts.id — never the
 * Instagram externalId, which is not a valid FK value. */
export async function insertPatternItems(input: {
  workspaceId: string;
  runId: string;
  segment: HarnessSegment;
  items: PatternItem[];
}): Promise<{ count: number; insertedByExternalId: Map<string, string> }> {
  if (input.items.length === 0) {
    return { count: 0, insertedByExternalId: new Map() };
  }
  const label = `${input.segment.kind}:${input.segment.value}`;
  const rows = await db
    .insert(patternPosts)
    .values(
      input.items.map((item) => ({
        workspaceId: input.workspaceId,
        pageHandle:
          input.segment.kind === "competitor_handle"
            ? input.segment.value.replace(/^@/, "")
            : input.segment.value,
        externalId: item.externalId ?? null,
        caption: item.caption ?? null,
        format: item.format,
        postedAt: item.postedAt,
        likes: item.likes ?? null,
        comments: item.comments ?? null,
        raw: item.raw,
        runId: input.runId,
        segment: label,
      })),
    )
    .returning({ id: patternPosts.id, externalId: patternPosts.externalId });

  const insertedByExternalId = new Map<string, string>();
  for (const row of rows) {
    if (row.externalId) insertedByExternalId.set(row.externalId, row.id);
  }
  return { count: rows.length, insertedByExternalId };
}

/**
 * One-off pattern insert from the Accounts "add public page" form. Shares
 * this file with insertPatternItems so a future patternPosts schema change
 * only needs updating in one place. These rows have no runId/segment (they
 * aren't from a configured Harness rule), so those provenance columns stay
 * null by design — the KB "Top performers" list already renders the segment
 * badge conditionally.
 */
export async function insertPublicPagePosts(input: {
  workspaceId: string;
  handle: string;
  items: PatternItem[];
}): Promise<{ count: number }> {
  if (input.items.length === 0) return { count: 0 };
  const rows = await db
    .insert(patternPosts)
    .values(
      input.items.map((item) => ({
        workspaceId: input.workspaceId,
        pageHandle: input.handle.replace(/^@/, ""),
        externalId: item.externalId ?? null,
        caption: item.caption ?? null,
        format: item.format,
        postedAt: item.postedAt,
        likes: item.likes ?? null,
        comments: item.comments ?? null,
        raw: item.raw,
      })),
    )
    .returning({ id: patternPosts.id });
  return { count: rows.length };
}

// ---------------------------------------------------------------------------
// A3: Pattern profiles (competitor snapshots)
// ---------------------------------------------------------------------------

/** Insert a batch of profile snapshots. */
export async function insertPatternProfiles(input: {
  workspaceId: string;
  items: PatternProfileItem[];
}) {
  if (input.items.length === 0) return 0;
  await db.insert(patternProfiles).values(
    input.items.map((item) => ({
      workspaceId: input.workspaceId,
      handle: item.handle,
      followers: item.followers,
      following: item.following,
      postsCount: item.postsCount,
      bio: item.bio,
      isVerified: item.isVerified,
      businessCategory: item.businessCategory,
      profilePicUrl: item.profilePicUrl,
      externalUrl: item.externalUrl,
      raw: item.raw,
    })),
  );
  return input.items.length;
}

/** List all profile snapshots for a workspace, newest first. */
export async function listPatternProfiles(
  workspaceId: string,
  limit = 50,
) {
  return db
    .select()
    .from(patternProfiles)
    .where(eq(patternProfiles.workspaceId, workspaceId))
    .orderBy(desc(patternProfiles.takenAt))
    .limit(limit);
}

/** Get the most recent snapshot for a given handle. */
export async function getLatestProfileSnapshot(
  workspaceId: string,
  handle: string,
) {
  const rows = await db
    .select()
    .from(patternProfiles)
    .where(
      and(
        eq(patternProfiles.workspaceId, workspaceId),
        eq(patternProfiles.handle, handle),
      ),
    )
    .orderBy(desc(patternProfiles.takenAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * A3: recent snapshots across all tracked handles, ordered handle asc then
 * takenAt desc so each handle's rows are contiguous with the latest first.
 * Feeds `profileDeltas` (src/lib/pattern-deltas.ts) — pattern layer only.
 * Limit 200 covers ~2 snapshots x up to 100 tracked handles; the pure
 * function only ever uses the latest two per handle.
 */
export function recentProfileSnapshotsQuery(workspaceId: string, limit = 200) {
  return db
    .select({
      handle: patternProfiles.handle,
      followers: patternProfiles.followers,
      postsCount: patternProfiles.postsCount,
      takenAt: patternProfiles.takenAt,
    })
    .from(patternProfiles)
    .where(eq(patternProfiles.workspaceId, workspaceId))
    .orderBy(asc(patternProfiles.handle), desc(patternProfiles.takenAt))
    .limit(limit);
}

export async function listRecentProfileSnapshots(workspaceId: string) {
  return recentProfileSnapshotsQuery(workspaceId);
}

// ---------------------------------------------------------------------------
// A4: Pattern comments (comment mining)
// ---------------------------------------------------------------------------

/** Insert a batch of comments for a pattern post. */
export async function insertPatternComments(input: {
  workspaceId: string;
  patternPostId: string;
  items: PatternCommentItem[];
}) {
  if (input.items.length === 0) return 0;
  await db.insert(patternComments).values(
    input.items.map((item) => ({
      workspaceId: input.workspaceId,
      patternPostId: input.patternPostId,
      authorHandle: item.authorHandle,
      text: item.text,
      likes: item.likes,
      takenAt: item.takenAt,
      raw: item.raw,
    })),
  );
  return input.items.length;
}

/** List comments for a specific pattern post. */
export async function listPatternComments(
  workspaceId: string,
  patternPostId: string,
) {
  return db
    .select()
    .from(patternComments)
    .where(
      and(
        eq(patternComments.workspaceId, workspaceId),
        eq(patternComments.patternPostId, patternPostId),
      ),
    )
    .orderBy(desc(patternComments.likes));
}
