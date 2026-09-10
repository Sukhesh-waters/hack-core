"use server";

import { z } from "zod";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { savePlanView } from "@/db/queries/plan-views";
import { isPlanGrouping, isPlanScope } from "@/lib/plan-view";
import { actionErrorMessage } from "@/lib/action-errors";

// ---------------------------------------------------------------------------
// U7 — "Save this view": persist the plan grid's current scope, grouping,
// and hidden columns as the caller's remembered default for this workspace.
// ---------------------------------------------------------------------------

const saveViewSchema = z.object({
  workspaceId: z.string().min(1),
  scope: z.string().min(1),
  clientId: z.string().optional(),
  targetUserId: z.string().optional(),
  grouping: z.string().min(1),
  hiddenColumns: z.array(z.string()).optional(),
});

export type SaveViewResult = { ok: true } | { ok: false; error: string };

/**
 * Wraps `savePlanView` with the auth/membership guard and re-validates scope
 * and grouping against the live enums (a stale client bundle could submit a
 * value the server no longer recognises).
 *
 * The row is always saved under the SESSION user's id, taken from
 * `requireUser()` — the input type doesn't even have a field for "whose
 * view this is," so there is nothing for a crafted request to override.
 * `targetUserId` here is the "assigned to person X" scope filter (i.e. whose
 * WORK the saved view shows), not who the view belongs to; those are
 * different ids and only the latter ever comes from the session.
 */
export async function savePlanViewAction(input: {
  workspaceId: string;
  scope: string;
  clientId?: string;
  targetUserId?: string;
  grouping: string;
  hiddenColumns?: string[];
}): Promise<SaveViewResult> {
  const parsed = saveViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Missing view details." };
  }
  const { workspaceId, scope, clientId, targetUserId, grouping, hiddenColumns } =
    parsed.data;
  if (!isPlanScope(scope) || !isPlanGrouping(grouping)) {
    return { ok: false, error: "Unrecognized view — reload and try again." };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    await savePlanView({
      workspaceId,
      userId: user.id,
      scope,
      clientId,
      targetUserId,
      grouping,
      hiddenColumns,
    });
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }

  return { ok: true };
}
