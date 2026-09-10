import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contentRevisions, users } from "@/db/schema";
import type { PlanEditableFields } from "@/lib/plan-cell";

// A plan row accumulates proposals, not history-of-everything. If a single
// row ever has more than this many, something is generating them in a loop.
const REVISIONS_CAP = 50;
// Whole-page pending pull for the grid drawer — bounded independently of
// how many rows the range happens to return.
const PAGE_REVISIONS_CAP = 200;

/** Every revision for one plan row, newest first, with the author's name. */
export function revisionsForContentQuery(
  workspaceId: string,
  contentId: string,
) {
  return db
    .select({
      id: contentRevisions.id,
      contentId: contentRevisions.contentId,
      authorKind: contentRevisions.authorKind,
      authorId: contentRevisions.authorId,
      authorName: users.name,
      fields: contentRevisions.fields,
      priorFields: contentRevisions.priorFields,
      note: contentRevisions.note,
      appliedAt: contentRevisions.appliedAt,
      appliedById: contentRevisions.appliedById,
      createdAt: contentRevisions.createdAt,
    })
    .from(contentRevisions)
    .leftJoin(users, eq(users.id, contentRevisions.authorId))
    .where(
      and(
        eq(contentRevisions.workspaceId, workspaceId),
        eq(contentRevisions.contentId, contentId),
      ),
    )
    .orderBy(desc(contentRevisions.createdAt))
    .limit(REVISIONS_CAP);
}

/** Unapplied proposals only — what the grid's "N suggestions" badge counts. */
export function pendingRevisionsQuery(workspaceId: string, contentId: string) {
  return db
    .select({
      id: contentRevisions.id,
      authorKind: contentRevisions.authorKind,
      fields: contentRevisions.fields,
      priorFields: contentRevisions.priorFields,
      createdAt: contentRevisions.createdAt,
    })
    .from(contentRevisions)
    .where(
      and(
        eq(contentRevisions.workspaceId, workspaceId),
        eq(contentRevisions.contentId, contentId),
        isNull(contentRevisions.appliedAt),
      ),
    )
    .orderBy(asc(contentRevisions.createdAt))
    .limit(REVISIONS_CAP);
}

/**
 * Unapplied counts for a page of rows, in one query rather than one per row.
 * Callers must skip this entirely for an empty id list — an unbounded
 * inArray() over nothing is still a table scan.
 */
export function pendingRevisionCountsQuery(
  workspaceId: string,
  contentIds: string[],
) {
  return db
    .select({
      contentId: contentRevisions.contentId,
      pending: count(contentRevisions.id),
    })
    .from(contentRevisions)
    .where(
      and(
        eq(contentRevisions.workspaceId, workspaceId),
        inArray(contentRevisions.contentId, contentIds),
        isNull(contentRevisions.appliedAt),
      ),
    )
    .groupBy(contentRevisions.contentId);
}

/** The pending proposals themselves for a page of rows, so the drawer can
 *  open without a round trip. Capped — the grid is already windowed. */
export function pendingRevisionsForContentsQuery(
  workspaceId: string,
  contentIds: string[],
) {
  return db
    .select({
      id: contentRevisions.id,
      contentId: contentRevisions.contentId,
      authorKind: contentRevisions.authorKind,
      fields: contentRevisions.fields,
      priorFields: contentRevisions.priorFields,
      note: contentRevisions.note,
      createdAt: contentRevisions.createdAt,
    })
    .from(contentRevisions)
    .where(
      and(
        eq(contentRevisions.workspaceId, workspaceId),
        inArray(contentRevisions.contentId, contentIds),
        isNull(contentRevisions.appliedAt),
      ),
    )
    .orderBy(asc(contentRevisions.createdAt))
    .limit(PAGE_REVISIONS_CAP);
}

export async function pendingRevisionsForContents(
  workspaceId: string,
  contentIds: string[],
) {
  if (contentIds.length === 0) return [];
  return pendingRevisionsForContentsQuery(workspaceId, contentIds);
}

export async function pendingRevisionCounts(
  workspaceId: string,
  contentIds: string[],
): Promise<Map<string, number>> {
  if (contentIds.length === 0) return new Map();
  const rows = await pendingRevisionCountsQuery(workspaceId, contentIds);
  return new Map(rows.map((r) => [r.contentId, Number(r.pending)]));
}

export function getRevisionQuery(workspaceId: string, revisionId: string) {
  return db
    .select()
    .from(contentRevisions)
    .where(
      and(
        eq(contentRevisions.workspaceId, workspaceId),
        eq(contentRevisions.id, revisionId),
      ),
    )
    .limit(1);
}

export async function recordRevision(input: {
  workspaceId: string;
  contentId: string;
  authorKind: "human" | "ai";
  authorId: string | null;
  fields: Partial<PlanEditableFields>;
  priorFields: Partial<PlanEditableFields>;
  note?: string;
}): Promise<string> {
  const [row] = await db
    .insert(contentRevisions)
    .values({
      workspaceId: input.workspaceId,
      contentId: input.contentId,
      authorKind: input.authorKind,
      // An AI proposal has no user behind it; storing the requesting user
      // here would misattribute the suggestion to a human in the history.
      authorId: input.authorKind === "ai" ? null : input.authorId,
      fields: input.fields,
      priorFields: input.priorFields,
      note: input.note ?? null,
    })
    .returning({ id: contentRevisions.id });
  return row.id;
}

/**
 * Stamps a revision as applied. The appliedAt IS NULL guard lives in the
 * WHERE, not in a prior read: two people accepting the same suggestion would
 * otherwise both pass the read and both apply it. A 0-row result means
 * someone got there first — the caller must report that, not treat it as
 * success. Same class of bug as the one guarded in advanceStage.
 */
export function markRevisionAppliedQuery(input: {
  workspaceId: string;
  revisionId: string;
  appliedById: string;
}) {
  return db
    .update(contentRevisions)
    .set({ appliedAt: new Date(), appliedById: input.appliedById })
    .where(
      and(
        eq(contentRevisions.workspaceId, input.workspaceId),
        eq(contentRevisions.id, input.revisionId),
        isNull(contentRevisions.appliedAt),
      ),
    )
    .returning({ id: contentRevisions.id });
}

export async function listRevisionsForContent(
  workspaceId: string,
  contentId: string,
) {
  return revisionsForContentQuery(workspaceId, contentId);
}
