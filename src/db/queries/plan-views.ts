import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { planViewPreferences } from "@/db/schema";
import {
  isPlanGrouping,
  isPlanScope,
  type PlanGrouping,
  type PlanScope,
} from "@/lib/plan-view";

export type SavedPlanView = {
  scope: PlanScope;
  clientId: string | null;
  userId: string | null;
  grouping: PlanGrouping;
  hiddenColumns: string[];
};

export function planViewQuery(workspaceId: string, userId: string) {
  return db
    .select()
    .from(planViewPreferences)
    .where(
      and(
        eq(planViewPreferences.workspaceId, workspaceId),
        eq(planViewPreferences.userId, userId),
      ),
    )
    .limit(1);
}

/**
 * The caller's saved view, or null if they have none.
 *
 * Stored scope/grouping are re-validated on read rather than trusted. A
 * scope removed from the code would otherwise be handed to the grid as a
 * live value and resolve to nothing — an old row must degrade to the
 * default, not break the page.
 */
export async function getSavedPlanView(
  workspaceId: string,
  userId: string,
): Promise<SavedPlanView | null> {
  const [row] = await planViewQuery(workspaceId, userId);
  if (!row) return null;
  return {
    scope: isPlanScope(row.scope) ? row.scope : "all",
    clientId: row.scopeClientId,
    userId: row.scopeUserId,
    grouping: isPlanGrouping(row.grouping) ? row.grouping : "none",
    hiddenColumns: row.hiddenColumns ?? [],
  };
}

/**
 * Upserts the caller's view. Keyed on (workspace, user) so a person's view
 * in one workspace never overwrites their view in another.
 */
export async function savePlanView(input: {
  workspaceId: string;
  userId: string;
  scope: PlanScope;
  clientId?: string | null;
  targetUserId?: string | null;
  grouping: PlanGrouping;
  hiddenColumns?: string[];
}): Promise<void> {
  const values = {
    workspaceId: input.workspaceId,
    userId: input.userId,
    scope: input.scope,
    // Clear the target a scope no longer needs, so switching from
    // "one client" to "all" doesn't leave a stale client id behind that
    // reappears the next time the user picks "one client".
    scopeClientId: input.scope === "client" ? (input.clientId ?? null) : null,
    scopeUserId: input.scope === "person" ? (input.targetUserId ?? null) : null,
    grouping: input.grouping,
    hiddenColumns: input.hiddenColumns ?? [],
    updatedAt: new Date(),
  };

  await db
    .insert(planViewPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: [planViewPreferences.workspaceId, planViewPreferences.userId],
      set: {
        scope: values.scope,
        scopeClientId: values.scopeClientId,
        scopeUserId: values.scopeUserId,
        grouping: values.grouping,
        hiddenColumns: values.hiddenColumns,
        updatedAt: values.updatedAt,
      },
    });
}
