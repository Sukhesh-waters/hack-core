"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { rejectIdea, updateIdeaFields } from "@/db/queries/ideas";
import { actionErrorMessage } from "@/lib/action-errors";
import { acceptIdea } from "@/lib/plan/accept-idea";

export type PlanState = { error?: string } | undefined;

function revalidatePlanAndProduction(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}/plan`);
  revalidatePath(`/w/${workspaceId}/production`);
}

const acceptSchema = z.object({
  workspaceId: z.string().min(1),
  ideaId: z.string().min(1),
});

export async function acceptIdeaAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const parsed = acceptSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ideaId: formData.get("ideaId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ideaId } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await acceptIdea({ workspaceId, ideaId, actorId: user.id });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePlanAndProduction(workspaceId);
  return undefined;
}

const editSchema = z.object({
  workspaceId: z.string().min(1),
  ideaId: z.string().min(1),
  topic: z.string().trim().min(3, "Topic is too short").max(120),
  hook: z.string().trim().min(3, "Hook is too short").max(200),
  angle: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  format: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function editIdeaAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const parsed = editSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ideaId: formData.get("ideaId"),
    topic: formData.get("topic"),
    hook: formData.get("hook"),
    angle: formData.get("angle"),
    format: formData.get("format"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ideaId, ...fields } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const updated = await updateIdeaFields(workspaceId, ideaId, fields);
    if (updated.length === 0) {
      return {
        error: "This idea was already accepted or rejected — your edit wasn't saved.",
      };
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/plan`);
  return undefined;
}

const rejectSchema = z.object({
  workspaceId: z.string().min(1),
  ideaId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

export async function rejectIdeaAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const parsed = rejectSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ideaId: formData.get("ideaId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ideaId, reason } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await rejectIdea(workspaceId, ideaId, reason);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/plan`);
  return undefined;
}

const bulkSchema = z.object({
  workspaceId: z.string().min(1),
  ideaIds: z.array(z.string().min(1)).min(1),
  reason: z.string().trim().max(500).optional(),
});

export async function bulkAcceptIdeasAction(
  workspaceId: string,
  ideaIds: string[],
): Promise<PlanState> {
  try {
    const parsed = bulkSchema.parse({ workspaceId, ideaIds });
    const user = await requireUser();
    await requireMembership(parsed.workspaceId, user.id);
    for (const ideaId of parsed.ideaIds) {
      await acceptIdea({ workspaceId: parsed.workspaceId, ideaId, actorId: user.id });
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePlanAndProduction(workspaceId);
  return undefined;
}

export async function bulkRejectIdeasAction(
  workspaceId: string,
  ideaIds: string[],
  reason?: string,
): Promise<PlanState> {
  try {
    const parsed = bulkSchema.parse({ workspaceId, ideaIds, reason });
    const user = await requireUser();
    await requireMembership(parsed.workspaceId, user.id);
    for (const ideaId of parsed.ideaIds) {
      await rejectIdea(parsed.workspaceId, ideaId, parsed.reason ?? "Bulk rejected");
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePlanAndProduction(workspaceId);
  return undefined;
}
