"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { content } from "@/db/schema";
import { getContentById } from "@/db/queries/clients";
import { requireCapability } from "@/db/queries/memberships";
import { scheduleContent } from "@/db/queries/schedule";
import { actionErrorMessage } from "@/lib/action-errors";
import { emitDomainEvent } from "@/lib/events/dispatch";
import { closeComplianceGatesForContent } from "@/db/queries/sop";

export type ApprovalState = { error?: string } | undefined;

const approveSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
});

/** review → approved. Only compliance-passed content gets through. */
export async function approveAction(
  _prev: ApprovalState,
  formData: FormData,
): Promise<ApprovalState> {
  const parsed = approveSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "approval.decide");

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { error: "Content not found." };
    if (row.status !== "review") {
      return { error: "Only content in review can be approved." };
    }
    if (row.complianceStatus !== "passed") {
      return { error: "Compliance hasn't passed — run it in the studio." };
    }

    await db
      .update(content)
      .set({ status: "approved" })
      .where(
        and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)),
      );

    const touchedRuns = await closeComplianceGatesForContent({
      workspaceId,
      contentId,
      userId: user.id,
    });

    for (const runId of touchedRuns) {
      revalidatePath(`/w/${workspaceId}/sop/runs/${runId}`);
    }

    // Emit domain event (writes to activity, broadcasts realtime scopes, sends Inngest domain/approval.decided)
    await emitDomainEvent({
      verb: "approval.decided",
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      decision: "approved",
      actorId: user.id,
      meta: { touchedRunsCount: touchedRuns.length },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/approvals`);
  return undefined;
}

/** approved → review ("Un-approve"), allowed only while unscheduled. */
export async function unapproveAction(
  _prev: ApprovalState,
  formData: FormData,
): Promise<ApprovalState> {
  const parsed = approveSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "approval.decide");

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { error: "Content not found." };
    if (row.status !== "approved") {
      return { error: "Only approved content can be un-approved." };
    }

    await db
      .update(content)
      .set({ status: "review" })
      .where(
        and(
          eq(content.workspaceId, workspaceId),
          eq(content.id, contentId),
          eq(content.status, "approved"),
        ),
      );

    await emitDomainEvent({
      verb: "content.state_changed",
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      from: "approved",
      to: "review",
      actorId: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/approvals`);
  return undefined;
}

const scheduleSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  scheduledFor: z.coerce.date(),
});

/** approved → scheduled with a future slot on the calendar. */
export async function scheduleAction(
  _prev: ApprovalState,
  formData: FormData,
): Promise<ApprovalState> {
  const parsed = scheduleSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    scheduledFor: formData.get("scheduledFor"),
  });
  if (!parsed.success) return { error: "Pick a valid date and time." };
  const { workspaceId, contentId, scheduledFor } = parsed.data;
  if (scheduledFor.getTime() <= Date.now()) {
    return { error: "Schedule time must be in the future." };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "approval.decide");

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { error: "Content not found." };
    if (row.status !== "approved") {
      return { error: "Approve the content before scheduling it." };
    }

    await scheduleContent({
      workspaceId,
      clientId: row.clientId,
      contentId,
      scheduledFor,
      actorId: user.id,
    });

    await emitDomainEvent({
      verb: "content.scheduled",
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      scheduledAt: scheduledFor,
      actorId: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/approvals`);
  revalidatePath(`/w/${workspaceId}/calendar`);
  return undefined;
}
