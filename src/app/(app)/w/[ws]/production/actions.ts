"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { contentType, productionStage } from "@/db/schema";
import { getClientById } from "@/db/queries/clients";
import { advanceStage, createProductionCard } from "@/db/queries/production";
import { transitionContent } from "@/db/queries/workflow";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { emitDomainEvent } from "@/lib/events/dispatch";

export type ProductionState = { error?: string } | undefined;

const transitionSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  toStateId: z.string().min(1),
});

/**
 * W3 — the engine-backed move.
 *
 * Takes only the DESTINATION. The old action took `from` and `to` as enum
 * values supplied by the client, which meant a stale tab could assert a
 * source it wasn't in; here the source is read server-side from the row and
 * the write is guarded on it, so a raced move fails loudly instead of
 * applying against the wrong state.
 *
 * Legality is decided against the workspace's own workflow rows, so a
 * workspace that renamed or added a state gets its process enforced rather
 * than ours.
 */
export async function transitionContentAction(
  _prev: ProductionState,
  formData: FormData,
): Promise<ProductionState> {
  const parsed = transitionSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    toStateId: formData.get("toStateId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId, toStateId } = parsed.data;

  try {
    const user = await requireUser();
    const membership = await requireMembership(workspaceId, user.id);
    const result = await transitionContent({
      workspaceId,
      contentId,
      toStateId,
      actorId: user.id,
      actorRole: membership.role,
    });
    if (!result.ok) return { error: result.error };

    await emitDomainEvent({
      verb: "content.transitioned",
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      actorId: user.id,
      meta: { toStateId, toName: result.toName },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/production`);
  revalidatePath(`/w/${workspaceId}/calendar`);
  return undefined;
}

const advanceSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  from: z.enum(productionStage.enumValues),
  to: z.enum(productionStage.enumValues),
});

export async function advanceProductionStageAction(
  _prev: ProductionState,
  formData: FormData,
): Promise<ProductionState> {
  const parsed = advanceSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    from: formData.get("from"),
    to: formData.get("to"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId, from, to } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await advanceStage({ workspaceId, contentId, from, to, actorId: user.id });

    await emitDomainEvent({
      verb: "content.stage_advanced",
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      actorId: user.id,
      meta: { from, to },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}

const newCardSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  title: z.string().trim().min(1, "Give the card a title.").max(140),
  type: z.enum(contentType.enumValues),
});

export async function createProductionCardAction(
  _prev: ProductionState,
  formData: FormData,
): Promise<ProductionState> {
  const parsed = newCardSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    type: formData.get("type"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId, title, type } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };
    const cardId = await createProductionCard({ workspaceId, clientId, title, type });

    await emitDomainEvent({
      verb: "content.created",
      workspaceId,
      subjectType: "content",
      subjectId: cardId,
      actorId: user.id,
      meta: { title, type, clientId },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}
