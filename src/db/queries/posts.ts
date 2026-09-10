import { and, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { postEmbeddings, posts } from "@/db/schema";
import type { BaselinePoint } from "@/lib/scoring";

/**
 * Two-layer rule: the baseline/scoring engine reads first-party rows ONLY.
 * Public pattern rows (source='public', Phase 2) must never pass this filter.
 * Guardrail test: src/db/queries/posts.test.ts (CI-gated).
 */
export function baselineQuery(workspaceId: string, clientId: string) {
  return db
    .select({ engagementRate: posts.engagementRate, postedAt: posts.postedAt })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.clientId, clientId),
        eq(posts.source, "first_party"),
      ),
    );
}

/**
 * G2 — first-party posts for a client, for the decision evidence picker
 * AND the server-side allow-list validateDecisionEvidence checks against.
 * Same two-layer filter as baselineQuery above: source='first_party' only.
 */
export function firstPartyPostsForClientQuery(
  workspaceId: string,
  clientId: string,
) {
  return db
    .select({ id: posts.id, caption: posts.caption, postedAt: posts.postedAt })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.clientId, clientId),
        eq(posts.source, "first_party"),
      ),
    )
    .orderBy(desc(posts.postedAt))
    .limit(100);
}

export async function listFirstPartyPostsForClient(
  workspaceId: string,
  clientId: string,
) {
  return firstPartyPostsForClientQuery(workspaceId, clientId);
}

export async function getBaselinePoints(
  workspaceId: string,
  clientId: string,
): Promise<BaselinePoint[]> {
  const rows = await baselineQuery(workspaceId, clientId);
  return rows
    .filter(
      (row): row is { engagementRate: number; postedAt: Date } =>
        row.engagementRate !== null,
    )
    .map((row) => ({ value: row.engagementRate, postedAt: row.postedAt }));
}

/** Dedup guard for connector syncs (Meta pull re-fetches the same recent
 * media on every run — without this, first-party posts and the baseline
 * they feed would duplicate on every sync). Guardrail test: posts.test.ts. */
export function existingPostExternalIdsQuery(
  workspaceId: string,
  clientId: string,
  externalIds: string[],
) {
  return db
    .select({ externalId: posts.externalId })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.clientId, clientId),
        inArray(posts.externalId, externalIds),
      ),
    );
}

export async function listExistingPostExternalIds(
  workspaceId: string,
  clientId: string,
  externalIds: string[],
): Promise<string[]> {
  if (externalIds.length === 0) return [];
  const rows = await existingPostExternalIdsQuery(
    workspaceId,
    clientId,
    externalIds,
  );
  return rows.flatMap((r) => (r.externalId ? [r.externalId] : []));
}

export async function listPosts(
  workspaceId: string,
  opts: { clientId?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        opts.clientId ? eq(posts.clientId, opts.clientId) : undefined,
      ),
    )
    .orderBy(desc(posts.postedAt))
    .limit(opts.limit ?? 100);
}

export async function getKbStats(workspaceId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      baselineSize: sql<number>`count(*) filter (where ${posts.source} = 'first_party' and ${posts.engagementRate} is not null)::int`,
      scored: sql<number>`count(*) filter (where ${posts.scoreStatus} = 'scored')::int`,
      medianEngagement: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${posts.engagementRate})`,
    })
    .from(posts)
    .where(eq(posts.workspaceId, workspaceId));
  return row;
}

/**
 * Phase 3 retrieval. Two-layer rule: everything the driver brief (and thus
 * every idea citation) can see is hard-filtered to source='first_party' —
 * on BOTH the posts and embeddings tables. Guardrail: posts.test.ts.
 */
export function similarPostsQuery(
  workspaceId: string,
  clientId: string,
  embedding: number[],
) {
  return db
    .select({
      id: posts.id,
      caption: posts.caption,
      direction: posts.direction,
      magnitude: posts.magnitude,
      format: posts.format,
    })
    .from(postEmbeddings)
    .innerJoin(posts, eq(postEmbeddings.postId, posts.id))
    .where(
      and(
        eq(postEmbeddings.workspaceId, workspaceId),
        eq(postEmbeddings.source, "first_party"),
        eq(posts.clientId, clientId),
        eq(posts.source, "first_party"),
      ),
    )
    .orderBy(cosineDistance(postEmbeddings.embedding, embedding))
    .limit(8);
}

export function topMoversQuery(
  workspaceId: string,
  clientId: string,
  direction: "up" | "down",
  limit: number,
) {
  return db
    .select({
      id: posts.id,
      caption: posts.caption,
      direction: posts.direction,
      magnitude: posts.magnitude,
      format: posts.format,
    })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.clientId, clientId),
        eq(posts.source, "first_party"),
        eq(posts.scoreStatus, "scored"),
        eq(posts.direction, direction),
      ),
    )
    .orderBy(desc(posts.magnitude))
    .limit(limit);
}

/**
 * Two-layer rule: citation captions must resolve to first-party rows only,
 * same as every other query in this file. Write-time validation already keeps
 * pattern-layer ids out of ideas.citations, but this read-side filter is the
 * defense-in-depth that stops any future write path from surfacing a
 * pattern-layer post here mislabeled as first-party. Guardrail: posts.test.ts.
 */
export function postsByIdsQuery(workspaceId: string, ids: string[]) {
  return db
    .select({ id: posts.id, caption: posts.caption, direction: posts.direction })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.source, "first_party"),
        inArray(posts.id, ids),
      ),
    );
}

export async function getPostsByIds(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return postsByIdsQuery(workspaceId, ids);
}
