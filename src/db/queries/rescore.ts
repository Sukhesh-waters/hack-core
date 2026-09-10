import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { postEmbeddings, posts } from "@/db/schema";
import type { ScoreUpdate } from "@/lib/rescore";

/** First-party rows only — pattern posts live in their own table and can
 * never enter scoring (two-layer rule). */
export function scorablePostsQuery(workspaceId: string) {
  return db
    .select({
      id: posts.id,
      clientId: posts.clientId,
      engagementRate: posts.engagementRate,
      postedAt: posts.postedAt,
    })
    .from(posts)
    .where(
      and(eq(posts.workspaceId, workspaceId), eq(posts.source, "first_party")),
    );
}

export async function listScorablePosts(workspaceId: string) {
  return scorablePostsQuery(workspaceId);
}

export async function applyScoreUpdates(updates: ScoreUpdate[]) {
  for (const update of updates) {
    await db
      .update(posts)
      .set({
        zScore: update.zScore,
        magnitude: update.magnitude,
        direction: update.direction,
        scoreStatus: update.scoreStatus,
      })
      .where(eq(posts.id, update.id));
  }
}

export function postsMissingEmbeddingsQuery(workspaceId: string, limit = 200) {
  return db
    .select({ id: posts.id, caption: posts.caption })
    .from(posts)
    .leftJoin(postEmbeddings, eq(postEmbeddings.postId, posts.id))
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        isNull(postEmbeddings.id),
        isNotNull(posts.caption),
      ),
    )
    .limit(limit);
}

export async function listPostsMissingEmbeddings(workspaceId: string) {
  return postsMissingEmbeddingsQuery(workspaceId);
}
