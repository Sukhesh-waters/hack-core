import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { platinaAlertRules, platinaOpsChecks } from "@/db/platina-schema";

/** C7.1 ops board: the stored checks, per workspace. Every query filters workspace_id. */

export type OpsCheckRow = typeof platinaOpsChecks.$inferSelect;

export async function insertOpsChecks(rows: (typeof platinaOpsChecks.$inferInsert)[]): Promise<void> {
  if (rows.length) await db.insert(platinaOpsChecks).values(rows);
}

export function latestOpsRunQuery(workspaceId: string) {
  return db
    .select({ runId: platinaOpsChecks.runId, checkedAt: platinaOpsChecks.checkedAt })
    .from(platinaOpsChecks)
    .where(eq(platinaOpsChecks.workspaceId, workspaceId))
    .orderBy(desc(platinaOpsChecks.checkedAt))
    .limit(1);
}

export function opsRunChecksQuery(workspaceId: string, runId: string) {
  return db
    .select()
    .from(platinaOpsChecks)
    .where(and(eq(platinaOpsChecks.workspaceId, workspaceId), eq(platinaOpsChecks.runId, runId)));
}

/** The checks of the newest run, or [] before the first run. */
export async function latestOpsChecks(workspaceId: string): Promise<OpsCheckRow[]> {
  const [latest] = await latestOpsRunQuery(workspaceId);
  return latest ? opsRunChecksQuery(workspaceId, latest.runId) : [];
}

export function opsHistoryQuery(workspaceId: string, since: Date) {
  return db
    .select({ checkId: platinaOpsChecks.checkId, status: platinaOpsChecks.status, checkedAt: platinaOpsChecks.checkedAt })
    .from(platinaOpsChecks)
    .where(and(eq(platinaOpsChecks.workspaceId, workspaceId), gte(platinaOpsChecks.checkedAt, since)))
    .orderBy(platinaOpsChecks.checkedAt);
}

export function opsAlertRulesQuery(workspaceId: string) {
  return db
    .select({ id: platinaAlertRules.id })
    .from(platinaAlertRules)
    .where(and(eq(platinaAlertRules.workspaceId, workspaceId), eq(platinaAlertRules.source, "ops")));
}

/** The default "a flow turned red" rule, created once per workspace; people can edit or disable it. */
export async function ensureOpsAlertRule(workspaceId: string): Promise<void> {
  const existing = await opsAlertRulesQuery(workspaceId);
  if (existing.length > 0) return;
  await db.insert(platinaAlertRules).values({
    workspaceId,
    name: "Ops board: a flow is red",
    source: "ops",
    conditions: [{ field: "redChecks", op: "gt", value: 0 }],
    severity: "critical",
    actions: [],
  });
}

/** History older than this is dropped; the board shows 7 days. */
export const OPS_RETENTION_DAYS = 14;

export function pruneOpsChecksQuery(workspaceId: string, before: Date) {
  return db
    .delete(platinaOpsChecks)
    .where(and(eq(platinaOpsChecks.workspaceId, workspaceId), lt(platinaOpsChecks.checkedAt, before)));
}
