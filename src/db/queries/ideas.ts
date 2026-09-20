import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, ideas } from "@/db/schema";

export function ideasQuery(workspaceId: string) {
  return db.select().from(ideas).where(eq(ideas.workspaceId, workspaceId));
}

export async function listIdeas(
  workspaceId: string,
  opts: { clientId?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(ideas)
    .where(
      and(
        eq(ideas.workspaceId, workspaceId),
        opts.clientId ? eq(ideas.clientId, opts.clientId) : undefined,
      ),
    )
    .orderBy(desc(ideas.createdAt))
    .limit(opts.limit ?? 30);
}

export type NewIdeaRow = {
  workspaceId: string;
  clientId: string;
  topic: string;
  hook: string;
  angle: string | null;
  format: string | null;
  whyReason: string | null;
  citations: string[];
};

/** Batch insert of proposed ideas. Every row carries its own workspaceId. */
export async function createIdeas(rows: NewIdeaRow[]) {
  if (rows.length === 0) return;
  await db.insert(ideas).values(rows);
}

export async function getIdea(workspaceId: string, ideaId: string) {
  const rows = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.workspaceId, workspaceId), eq(ideas.id, ideaId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Builder for the atomic claim (exposed for SQL-shape assertions). */
export function claimIdeaForDraftingQuery(workspaceId: string, ideaId: string) {
  return db
    .update(ideas)
    .set({ status: "drafted" })
    .where(
      and(
        eq(ideas.workspaceId, workspaceId),
        eq(ideas.id, ideaId),
        eq(ideas.status, "new"),
      ),
    )
    .returning({ id: ideas.id });
}

/**
 * Race-safe claim: flips new → drafted atomically and returns the claimed
 * row only if THIS call won. Callers run the (multi-second) AI draft
 * generation AFTER a successful claim, so two concurrent accepts of the same
 * idea can't both generate a draft and both insert a content row. The loser
 * gets an empty array back. Guardrail test: ideas.test.ts.
 */
export async function claimIdeaForDrafting(workspaceId: string, ideaId: string) {
  return claimIdeaForDraftingQuery(workspaceId, ideaId);
}

/** Release a claim if draft generation fails after claiming, so the idea
 * doesn't get stranded in "drafted" with no content row behind it. */
export async function releaseIdeaClaim(workspaceId: string, ideaId: string) {
  await db
    .update(ideas)
    .set({ status: "new" })
    .where(
      and(
        eq(ideas.workspaceId, workspaceId),
        eq(ideas.id, ideaId),
        eq(ideas.status, "drafted"),
      ),
    );
}

/** Plan & Validate's proposed slot list — ideas awaiting a decision. */
export function newIdeasQuery(workspaceId: string) {
  return db
    .select({
      id: ideas.id,
      clientId: ideas.clientId,
      clientName: clients.name,
      topic: ideas.topic,
      hook: ideas.hook,
      angle: ideas.angle,
      format: ideas.format,
      whyReason: ideas.whyReason,
      citations: ideas.citations,
      createdAt: ideas.createdAt,
    })
    .from(ideas)
    .innerJoin(clients, eq(clients.id, ideas.clientId))
    .where(and(eq(ideas.workspaceId, workspaceId), eq(ideas.status, "new")))
    .orderBy(desc(ideas.createdAt));
}

export async function listNewIdeas(workspaceId: string) {
  return newIdeasQuery(workspaceId);
}

/** Reject-with-reason. Guarded to status="new" so a stale form can't
 *  mutate an already-decided idea. */
export async function rejectIdea(
  workspaceId: string,
  ideaId: string,
  reason: string | null,
) {
  await db
    .update(ideas)
    .set({ status: "archived", rejectionReason: reason })
    .where(
      and(
        eq(ideas.workspaceId, workspaceId),
        eq(ideas.id, ideaId),
        eq(ideas.status, "new"),
      ),
    );
}

/** Inline edit of a proposed idea's own fields — orthogonal to accept/reject.
 * Returns the affected rows so the caller can tell an edit that took from one
 * that no-op'd because the idea was concurrently accepted/rejected. */
export async function updateIdeaFields(
  workspaceId: string,
  ideaId: string,
  fields: {
    topic: string;
    hook: string;
    angle: string | null;
    format: string | null;
  },
) {
  return db
    .update(ideas)
    .set(fields)
    .where(
      and(
        eq(ideas.workspaceId, workspaceId),
        eq(ideas.id, ideaId),
        eq(ideas.status, "new"),
      ),
    )
    .returning({ id: ideas.id });
}
