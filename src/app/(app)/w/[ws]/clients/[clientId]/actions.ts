"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { createClientGoal } from "@/db/queries/client-goals";
import { clientGoalSchema } from "@/lib/validation";
import { actionErrorMessage } from "@/lib/action-errors";

export type ClientGoalActionState = { error?: string; savedAt?: number } | undefined;

const ok = (): ClientGoalActionState => ({ savedAt: Date.now() });

/** Any workspace member may set a client goal — same "Anyone" gating as
 *  ticket creation. Goals are a planning aid, not a sensitive control. */
export async function createClientGoalAction(
  _prev: ClientGoalActionState,
  formData: FormData,
): Promise<ClientGoalActionState> {
  const workspaceId = formData.get("workspaceId");
  const clientId = formData.get("clientId");
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  if (typeof clientId !== "string" || clientId.length === 0) {
    return { error: "Missing client" };
  }

  const parsed = clientGoalSchema.safeParse({
    title: formData.get("title"),
    hypothesis: formData.get("hypothesis") || null,
    metric: formData.get("metric"),
    targetWindowStart: formData.get("targetWindowStart"),
    targetWindowEnd: formData.get("targetWindowEnd"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    await createClientGoal({
      workspaceId,
      clientId,
      title: parsed.data.title,
      hypothesis: parsed.data.hypothesis ?? null,
      metric: parsed.data.metric,
      targetWindowStart: parsed.data.targetWindowStart,
      targetWindowEnd: parsed.data.targetWindowEnd,
      createdById: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/clients/${clientId}`);
  return ok();
}
