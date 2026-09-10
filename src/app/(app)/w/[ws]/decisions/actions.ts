"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getClientById } from "@/db/queries/clients";
import { getClientGoalById } from "@/db/queries/client-goals";
import { getInsightById } from "@/db/queries/insights";
import { firstPartyPostsForClientQuery } from "@/db/queries/posts";
import {
  createDecision,
  recordDecisionOutcome,
} from "@/db/queries/decisions";
import { decisionSchema } from "@/lib/validation";
import { validateDecisionEvidence, DECISION_OUTCOMES } from "@/lib/decisions";
import { actionErrorMessage } from "@/lib/action-errors";

export type DecisionActionState = { error?: string; savedAt?: number } | undefined;

const ok = (): DecisionActionState => ({ savedAt: Date.now() });

/** Any workspace member may record a decision — same "Anyone" gating as
 *  ticket/goal creation. This is a planning and reflection tool, not a
 *  sensitive control. */
export async function createDecisionAction(
  _prev: DecisionActionState,
  formData: FormData,
): Promise<DecisionActionState> {
  const workspaceId = formData.get("workspaceId");
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }

  const parsed = decisionSchema.safeParse({
    title: formData.get("title"),
    reason: formData.get("reason"),
    expectedOutcome: formData.get("expectedOutcome"),
    reviewAt: formData.get("reviewAt"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const clientIdRaw = formData.get("clientId");
  const clientId =
    typeof clientIdRaw === "string" && clientIdRaw.length > 0
      ? clientIdRaw
      : null;
  const goalIdRaw = formData.get("goalId");
  const goalId =
    typeof goalIdRaw === "string" && goalIdRaw.length > 0 ? goalIdRaw : null;
  const insightIdRaw = formData.get("insightId");
  const insightId =
    typeof insightIdRaw === "string" && insightIdRaw.length > 0
      ? insightIdRaw
      : null;
  const submittedEvidenceIds = formData.getAll("evidencePostIds").filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    // Never trust a client-supplied id as proof it belongs here — every
    // reference gets re-checked against this workspace (and, for the goal,
    // this client too) before the write. A forged id from another
    // workspace/client silently resolves to "reject", not a leak.
    if (clientId) {
      const client = await getClientById(workspaceId, clientId);
      if (!client) return { error: "That client isn't in this workspace." };
    }
    if (goalId) {
      if (!clientId) return { error: "Pick a client before a goal." };
      const goal = await getClientGoalById(workspaceId, clientId, goalId);
      if (!goal) return { error: "That goal isn't on this client." };
    }
    if (insightId) {
      const insight = await getInsightById(workspaceId, insightId);
      if (!insight) return { error: "That insight isn't in this workspace." };
    }

    // The two-layer guard (I2): evidence can only ever be first-party posts
    // belonging to the chosen client. No client selected means no scoped
    // baseline to cite — evidence is forced empty rather than left to trust
    // whatever the form submitted.
    const allowedFirstPartyIds = clientId
      ? (await firstPartyPostsForClientQuery(workspaceId, clientId)).map(
          (p) => p.id,
        )
      : [];
    const evidencePostIds = validateDecisionEvidence(
      submittedEvidenceIds,
      allowedFirstPartyIds,
    );

    await createDecision({
      workspaceId,
      clientId,
      goalId,
      title: parsed.data.title,
      reason: parsed.data.reason,
      evidencePostIds,
      insightId,
      expectedOutcome: parsed.data.expectedOutcome,
      reviewAt: parsed.data.reviewAt,
      ownerId: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/decisions`);
  if (clientId) revalidatePath(`/w/${workspaceId}/clients/${clientId}`);
  return ok();
}

const OUTCOME_VALUES = DECISION_OUTCOMES.filter((o) => o !== "pending");

export async function recordDecisionOutcomeAction(
  _prev: DecisionActionState,
  formData: FormData,
): Promise<DecisionActionState> {
  const workspaceId = formData.get("workspaceId");
  const decisionId = formData.get("decisionId");
  const outcome = formData.get("outcome");
  const outcomeNoteRaw = formData.get("outcomeNote");
  const outcomeNote =
    typeof outcomeNoteRaw === "string" && outcomeNoteRaw.trim().length > 0
      ? outcomeNoteRaw.trim().slice(0, 1000)
      : null;

  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  if (typeof decisionId !== "string" || decisionId.length === 0) {
    return { error: "Missing decision" };
  }
  if (
    typeof outcome !== "string" ||
    !(OUTCOME_VALUES as string[]).includes(outcome)
  ) {
    return { error: "Pick a valid outcome" };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const applied = await recordDecisionOutcome({
      workspaceId,
      decisionId,
      outcome: outcome as (typeof OUTCOME_VALUES)[number],
      outcomeNote,
    });
    if (!applied) {
      return {
        error: "This decision already has a recorded outcome — it can't be changed.",
      };
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/decisions`);
  return ok();
}
