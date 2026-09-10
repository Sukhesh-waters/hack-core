import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, content } from "@/db/schema";

export async function listClients(workspaceId: string) {
  return db
    .select()
    .from(clients)
    .where(eq(clients.workspaceId, workspaceId))
    .orderBy(desc(clients.createdAt));
}

export async function getClientById(workspaceId: string, clientId: string) {
  const rows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Builder exported for .toSQL() tests. */
export function setClientContactEmailQuery(
  workspaceId: string,
  clientId: string,
  contactEmail: string | null,
) {
  return db
    .update(clients)
    .set({ contactEmail })
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)))
    .returning({ id: clients.id });
}

/** Returns whether a row matched, so the caller can report "Client not
 *  found." on a stale/foreign client id instead of silently no-op'ing. */
export async function setClientContactEmail(
  workspaceId: string,
  clientId: string,
  contactEmail: string | null,
) {
  const rows = await setClientContactEmailQuery(
    workspaceId,
    clientId,
    contactEmail,
  );
  return rows.length > 0;
}

export async function listDrafts(workspaceId: string) {
  return db
    .select()
    .from(content)
    .where(eq(content.workspaceId, workspaceId))
    .orderBy(desc(content.createdAt))
    .limit(50);
}

export async function getContentById(workspaceId: string, contentId: string) {
  const rows = await db
    .select()
    .from(content)
    .where(and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Ads Management builder's Creative step — a client's existing drafts to
 *  link as campaign creative (no image/video generation exists). Also reused
 *  by F9.5's client detail page for the Content/Production section, hence
 *  productionStage being selected alongside the original id/title/type. */
export async function listContentForClient(
  workspaceId: string,
  clientId: string,
) {
  return db
    .select({
      id: content.id,
      title: content.title,
      type: content.type,
      productionStage: content.productionStage,
    })
    .from(content)
    .where(
      and(eq(content.workspaceId, workspaceId), eq(content.clientId, clientId)),
    )
    .orderBy(desc(content.createdAt))
    .limit(50);
}
