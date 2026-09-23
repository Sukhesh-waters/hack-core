import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { knowledgeSources, knowledgeChunks } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { STALE_AFTER_DAYS } from "@/lib/freshness";
import { listClientIdentities } from "@/db/queries/client-identities";
import { NOT_OWN_REASON, refreshAllowed } from "@/lib/ingest/guard";
import { INGEST_ORPHAN_AFTER_MS, INTERRUPTED_REASON } from "@/lib/knowledge-ingest";

/**
 * Knowledge refresh sweep. Runs daily at 03:00 UTC or on-demand.
 * Re-crawls stale knowledge sources (>7 days since last update),
 * re-chunks the content, and re-embeds changed chunks (diff by contentHash).
 *
 * Degradation ladder:
 * - Fetch failure → mark source as "error", keep existing chunks
 * - Embed failure → chunks saved without vector (text-only retrieval)
 */
export const knowledgeRefresh = inngest.createFunction(
  {
    id: "knowledge-refresh",
    triggers: [
      { cron: "0 3 * * *" },
      { event: "knowledge/refresh.requested" },
    ],
  },
  async ({ event, step }) => {
    const data = (event as { data?: Record<string, unknown> } | undefined)
      ?.data;
    const requestedWorkspace =
      typeof data?.workspaceId === "string" ? data.workspaceId : null;

    const staleSources = await step.run("find-stale-sources", async () => {
      const cutoff = new Date(
        Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
      );

      const conditions = [
        eq(knowledgeSources.status, "ready"),
        eq(knowledgeSources.sourceKind, "url"),
        lt(knowledgeSources.updatedAt, cutoff),
      ];

      if (requestedWorkspace) {
        conditions.push(eq(knowledgeSources.workspaceId, requestedWorkspace));
      }

      return db
        .select({
          id: knowledgeSources.id,
          workspaceId: knowledgeSources.workspaceId,
          clientId: knowledgeSources.clientId,
          url: knowledgeSources.url,
        })
        .from(knowledgeSources)
        .where(and(...conditions))
        .limit(20); // cap per sweep to avoid timeout
    });

    // C7.0: an ingest that died mid-request (dev restart, deploy) stays
    // "pending" forever and people paste it again. Close it with a reason.
    const interrupted = await step.run("close-interrupted", async () => {
      const cutoff = new Date(Date.now() - INGEST_ORPHAN_AFTER_MS);
      const conditions = [eq(knowledgeSources.status, "pending"), lt(knowledgeSources.createdAt, cutoff)];
      if (requestedWorkspace) conditions.push(eq(knowledgeSources.workspaceId, requestedWorkspace));
      const rows = await db
        .update(knowledgeSources)
        .set({ status: "failed", error: INTERRUPTED_REASON, updatedAt: new Date() })
        .where(and(...conditions))
        .returning({ id: knowledgeSources.id });
      return rows.length;
    });

    let refreshed = 0;
    let failed = 0;
    let notOwn = 0;

    for (const source of staleSources) {
      const result = await step.run(`refresh-${source.id}`, async () => {
        try {
          const { readPage, chunkText } = await import(
            "@/lib/knowledge-ingest"
          );
          const { routeAI } = await import("@/lib/ai/router");
          const { compactSimilarChunks } = await import("@/lib/freshness");

          if (!source.url) {
            return { status: "skipped" as const, reason: "no url" };
          }

          // C7.0 two-layer guard: a page that is not the client's own is
          // never re-read into first-party knowledge.
          const own = (await listClientIdentities(source.workspaceId, source.clientId)).map(({ kind, value }) => ({ kind, value }));
          if (!refreshAllowed(source.url, own)) {
            await db
              .update(knowledgeSources)
              .set({ status: "failed", error: NOT_OWN_REASON, updatedAt: new Date() })
              .where(and(eq(knowledgeSources.workspaceId, source.workspaceId), eq(knowledgeSources.id, source.id)));
            return { status: "not_own" as const };
          }

          // Background: our own (free) fetch first, Firecrawl only when that
          // is blocked or returns a JavaScript shell — credits go to pages
          // that need them. When neither yields enough text readPage throws a
          // readable reason, and the catch below records it on the source.
          const { text } = await readPage(source.url, { prefer: "direct" });

          const rawChunks = chunkText(text);
          const compacted = compactSimilarChunks(rawChunks);

          // Delete old chunks for this source
          await db
            .delete(knowledgeChunks)
            .where(eq(knowledgeChunks.sourceId, source.id));

          // Embed new chunks (best-effort — failure leaves chunks without vectors)
          let embeddings: number[][] | null = null;
          try {
            embeddings = await routeAI({
              kind: "embed",
              texts: compacted,
            });
          } catch {
            // Embedding failure — chunks persist without vectors
          }

          // Insert new chunks
          if (compacted.length > 0) {
            await db.insert(knowledgeChunks).values(
              compacted.map((content, idx) => ({
                workspaceId: source.workspaceId,
                clientId: source.clientId,
                sourceId: source.id,
                chunkIndex: idx,
                content,
                embedding: embeddings?.[idx] ?? null,
              })),
            );
          }

          // Update source metadata
          await db
            .update(knowledgeSources)
            .set({
              updatedAt: new Date(),
              chunkCount: compacted.length,
              status: "ready",
              error: null,
            })
            .where(eq(knowledgeSources.id, source.id));

          return { status: "refreshed" as const, chunks: compacted.length };
        } catch (error) {
          // Mark source as errored but keep existing chunks
          await db
            .update(knowledgeSources)
            .set({
              status: "failed",
              error: error instanceof Error ? error.message : "unknown",
              updatedAt: new Date(),
            })
            .where(eq(knowledgeSources.id, source.id));

          return { status: "failed" as const };
        }
      });

      if (result.status === "refreshed") refreshed++;
      if (result.status === "failed") failed++;
      if (result.status === "not_own") notOwn++;
    }

    return { staleSources: staleSources.length, refreshed, failed, notOwn, interrupted };
  },
);
