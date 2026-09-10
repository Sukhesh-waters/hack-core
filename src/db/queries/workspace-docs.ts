import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { workspaceDocs } from "@/db/schema";

/**
 * List-view builder — id/slug/title/kind/updatedAt only (no `body`), keeping
 * the list-page payload small. Workspace-scoped, newest-updated first.
 * `kind` is returned (not filtered) so the list page can section into
 * "Docs"/"SOPs" client-side without a second query.
 */
export function listWorkspaceDocsQuery(workspaceId: string) {
  return db
    .select({
      id: workspaceDocs.id,
      slug: workspaceDocs.slug,
      title: workspaceDocs.title,
      kind: workspaceDocs.kind,
      updatedAt: workspaceDocs.updatedAt,
      updatedById: workspaceDocs.updatedById,
    })
    .from(workspaceDocs)
    .where(eq(workspaceDocs.workspaceId, workspaceId))
    .orderBy(desc(workspaceDocs.updatedAt));
}

export async function listWorkspaceDocs(workspaceId: string) {
  return listWorkspaceDocsQuery(workspaceId);
}

/**
 * Single-doc lookup builder — workspace AND slug scoped (the composite that
 * proves slug uniqueness is enforced per-workspace, not globally). Full row,
 * including `body`, for the detail page.
 */
export function getWorkspaceDocBySlugQuery(
  workspaceId: string,
  slug: string,
) {
  return db
    .select()
    .from(workspaceDocs)
    .where(
      and(
        eq(workspaceDocs.workspaceId, workspaceId),
        eq(workspaceDocs.slug, slug),
      ),
    )
    .limit(1);
}

export async function getWorkspaceDocBySlug(workspaceId: string, slug: string) {
  const rows = await getWorkspaceDocBySlugQuery(workspaceId, slug);
  return rows[0] ?? null;
}

/**
 * Insert. Slug-collision handling is the action layer's job (pre-check via
 * getWorkspaceDocBySlug before calling this, same precedent as claimOrg's
 * slug pre-check in src/app/(app)/org/claim/actions.ts) — this stays a
 * plain insert so the DB's unique index remains the last-line backstop, not
 * the primary UX.
 */
export async function createWorkspaceDoc(input: {
  workspaceId: string;
  slug: string;
  title: string;
  body: string;
  kind?: "doc" | "sop" | "auto";
  createdById: string;
}): Promise<string> {
  const [row] = await db
    .insert(workspaceDocs)
    .values({
      workspaceId: input.workspaceId,
      slug: input.slug,
      title: input.title,
      body: input.body,
      kind: input.kind ?? "doc",
      createdById: input.createdById,
      updatedById: input.createdById,
    })
    .returning({ id: workspaceDocs.id });
  return row.id;
}

/** Guard-in-WHERE builder (exposed for SQL-shape assertions) — workspace +
 *  id scoped, bumps `updatedAt`. */
export function updateWorkspaceDocQuery(
  workspaceId: string,
  docId: string,
  fields: {
    title?: string;
    body?: string;
    kind?: "doc" | "sop" | "auto";
    updatedById: string;
  },
) {
  return db
    .update(workspaceDocs)
    .set({
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.body !== undefined ? { body: fields.body } : {}),
      ...(fields.kind !== undefined ? { kind: fields.kind } : {}),
      updatedById: fields.updatedById,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceDocs.workspaceId, workspaceId),
        eq(workspaceDocs.id, docId),
      ),
    )
    .returning({ id: workspaceDocs.id });
}

export async function updateWorkspaceDoc(
  workspaceId: string,
  docId: string,
  fields: {
    title?: string;
    body?: string;
    kind?: "doc" | "sop" | "auto";
    updatedById: string;
  },
) {
  const rows = await updateWorkspaceDocQuery(workspaceId, docId, fields);
  if (rows.length === 0) {
    throw new Error("Doc not found");
  }
  return rows[0];
}

export function listStaleWorkspaceDocsQuery(
  workspaceId: string,
  staleThresholdDays = 30,
) {
  const cutoff = new Date(Date.now() - staleThresholdDays * 24 * 60 * 60 * 1000);
  return db
    .select({
      id: workspaceDocs.id,
      title: workspaceDocs.title,
      slug: workspaceDocs.slug,
      updatedAt: workspaceDocs.updatedAt,
    })
    .from(workspaceDocs)
    .where(
      and(
        eq(workspaceDocs.workspaceId, workspaceId),
        lte(workspaceDocs.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(workspaceDocs.updatedAt))
    .limit(50);
}
