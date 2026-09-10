import { and, cosineDistance, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";

export function knowledgeSourcesQuery(workspaceId: string, clientId: string) {
  return db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.workspaceId, workspaceId),
        eq(knowledgeSources.clientId, clientId),
      ),
    )
    .orderBy(desc(knowledgeSources.createdAt));
}

export async function listKnowledgeSources(
  workspaceId: string,
  clientId: string,
) {
  return knowledgeSourcesQuery(workspaceId, clientId);
}

export async function createKnowledgeSource(
  workspaceId: string,
  clientId: string,
  url: string,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(knowledgeSources)
    .values({ workspaceId, clientId, url, status: "pending" })
    .returning({ id: knowledgeSources.id });
  return row;
}

export function createAssetKnowledgeSourceQuery(
  workspaceId: string,
  clientId: string,
  assetId: string,
  title: string,
) {
  return db
    .insert(knowledgeSources)
    .values({
      workspaceId,
      clientId,
      assetId,
      title,
      sourceKind: "asset",
      status: "pending",
    })
    .returning({ id: knowledgeSources.id });
}

export async function createAssetKnowledgeSource(
  workspaceId: string,
  clientId: string,
  assetId: string,
  title: string,
): Promise<{ id: string }> {
  const [row] = await createAssetKnowledgeSourceQuery(
    workspaceId,
    clientId,
    assetId,
    title,
  );
  return row;
}

export async function updateKnowledgeSource(
  workspaceId: string,
  id: string,
  patch:
    | { status: "ready"; title: string | null; chunkCount: number; error: null }
    | { status: "failed"; error: string },
) {
  await db
    .update(knowledgeSources)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSources.workspaceId, workspaceId),
        eq(knowledgeSources.id, id),
      ),
    );
}

export async function insertKnowledgeChunks(
  rows: {
    workspaceId: string;
    clientId: string;
    sourceId: string;
    chunkIndex: number;
    content: string;
    embedding?: number[] | null;
  }[],
) {
  if (rows.length === 0) return;
  await db.insert(knowledgeChunks).values(rows);
}

/**
 * Vault similarity search — mirrors similarPostsQuery (src/db/queries/posts.ts).
 * Workspace + client scoped, excludes chunks whose embedding failed rather
 * than erroring on a null vector.
 */
export function similarKnowledgeChunksQuery(
  workspaceId: string,
  clientId: string,
  embedding: number[],
  limit = 6,
) {
  return db
    .select({
      id: knowledgeChunks.id,
      content: knowledgeChunks.content,
      chunkIndex: knowledgeChunks.chunkIndex,
      sourceUrl: knowledgeSources.url,
      sourceTitle: knowledgeSources.title,
      sourceKind: knowledgeSources.sourceKind,
      assetId: knowledgeSources.assetId,
    })
    .from(knowledgeChunks)
    .innerJoin(
      knowledgeSources,
      eq(knowledgeChunks.sourceId, knowledgeSources.id),
    )
    .where(
      and(
        eq(knowledgeChunks.workspaceId, workspaceId),
        eq(knowledgeChunks.clientId, clientId),
        isNotNull(knowledgeChunks.embedding),
      ),
    )
    .orderBy(cosineDistance(knowledgeChunks.embedding, embedding))
    .limit(limit);
}
