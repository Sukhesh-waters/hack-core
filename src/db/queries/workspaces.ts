import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";

/**
 * G2 — enumeration only, for the daily decision-review cron to loop over.
 * Every subsequent read/write in that loop is scoped by the workspaceId
 * this returns, same discipline as listEnabledAutomationRules (the other
 * cross-workspace query in this app) — this is arguably the safer shape of
 * the two, since it never returns another workspace's row data, only ids.
 */
export async function listAllWorkspaceIds(): Promise<string[]> {
  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  return rows.map((r) => r.id);
}

export async function getWorkspaceById(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

/** Lookup for the /join flow: accepts a workspace slug or invite code. */
export async function findWorkspaceByCode(code: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(or(eq(workspaces.slug, code), eq(workspaces.inviteCode, code)))
    .limit(1);
  return rows[0] ?? null;
}

