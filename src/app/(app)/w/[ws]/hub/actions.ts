"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { hubTasks, sopRunSteps } from "@/db/schema";
import { requireMembership } from "@/db/queries/memberships";
import { moveRunStep } from "@/db/queries/sop";
import {
  addHubReminder,
  addHubTask,
  addHubTextMessage,
  archiveHubTask,
  createHubApproval,
  decideHubApproval,
  reopenHubTask,
  setHubTaskPriority,
  updateHubTaskTitle,
} from "@/db/queries/hub";
import { rejectIdea } from "@/db/queries/ideas";
import { liveTeamHub } from "@/lib/data/live/team-hub";
import { broadcastHubSignal, type HubScope } from "@/lib/realtime";
import { actionErrorMessage } from "@/lib/action-errors";
import { acceptIdea } from "@/lib/plan/accept-idea";
import {
  doneFromHubTaskStatus,
  HUB_TASK_STATUS_LABELS,
  isValidHubTaskTransition,
  type HubTaskStatus,
} from "@/lib/hub-workflow";
import type { TeamHubData } from "@/lib/data/types";

export type HubActionResult =
  | { data: TeamHubData; error?: undefined }
  | { data?: undefined; error: string };

const ws = z.string().min(1);

async function guard(workspaceId: string) {
  const user = await requireUser();
  await requireMembership(workspaceId, user.id);
  return user;
}

async function stateAfter(
  workspaceId: string,
  scope: HubScope,
): Promise<HubActionResult> {
  await broadcastHubSignal(workspaceId, scope);
  return { data: await liveTeamHub(workspaceId) };
}

export async function fetchHubState(
  workspaceId: string,
): Promise<HubActionResult> {
  try {
    const parsed = ws.parse(workspaceId);
    await guard(parsed);
    return { data: await liveTeamHub(parsed) };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const messageSchema = z.object({
  workspaceId: ws,
  body: z.string().trim().min(1).max(2000),
});

export async function sendHubMessage(
  workspaceId: string,
  body: string,
): Promise<HubActionResult> {
  try {
    const input = messageSchema.parse({ workspaceId, body });
    const user = await guard(input.workspaceId);
    await addHubTextMessage({
      workspaceId: input.workspaceId,
      authorId: user.id,
      body: input.body,
    });
    return await stateAfter(input.workspaceId, "messages");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const approvalSchema = z.object({
  workspaceId: ws,
  title: z.string().trim().min(1).max(300),
});

export async function requestHubApproval(
  workspaceId: string,
  title: string,
): Promise<HubActionResult> {
  try {
    const input = approvalSchema.parse({ workspaceId, title });
    const user = await guard(input.workspaceId);
    await createHubApproval({
      workspaceId: input.workspaceId,
      requestedById: user.id,
      title: input.title,
    });
    return await stateAfter(input.workspaceId, "approvals");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const decideSchema = z.object({
  workspaceId: ws,
  approvalId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
});

export async function decideApproval(
  workspaceId: string,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<HubActionResult> {
  try {
    const input = decideSchema.parse({ workspaceId, approvalId, decision });
    const user = await guard(input.workspaceId);
    await decideHubApproval({
      workspaceId: input.workspaceId,
      approvalId: input.approvalId,
      deciderId: user.id,
      status: input.decision,
    });
    return await stateAfter(input.workspaceId, "approvals");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const taskSchema = z.object({
  workspaceId: ws,
  title: z.string().trim().min(1).max(300),
});

export async function createTask(
  workspaceId: string,
  title: string,
): Promise<HubActionResult> {
  try {
    const input = taskSchema.parse({ workspaceId, title });
    const user = await guard(input.workspaceId);
    await addHubTask({
      workspaceId: input.workspaceId,
      createdById: user.id,
      title: input.title,
    });
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const taskStatusSchema = z.object({
  workspaceId: ws,
  taskId: z.string().min(1),
  from: z.enum(["open", "done"]),
  to: z.enum(["open", "done"]),
});

/**
 * Moves a hub task between "open" and "done" (the view over `done` defined
 * in `@/lib/hub-workflow`). Never trusts the client's claimed `from` alone —
 * `isValidHubTaskTransition` re-checks it server-side against the same graph
 * the menu rendered from, and the UPDATE's WHERE clause matches on the
 * current `done` value too. If another change (or another tab) already
 * moved the task, 0 rows match and this reports "already changed" instead
 * of silently overwriting whatever the task had become.
 *
 * No activity row is written for this move: `hubTasks` is a deliberate
 * scratch list (see CLAUDE.md — no assignee column, never promoted to a
 * ticket in place), and none of `activitySubject`'s allowed values
 * ("content" | "idea" | "ticket" | "campaign" | "doc" | "client") honestly
 * describes a hub task. Mislabelling it under "ticket" would blur exactly
 * the distinction the scratch-list design is protecting, so this is skipped
 * rather than mislabelled.
 */
export async function setHubTaskStatus(
  workspaceId: string,
  taskId: string,
  from: HubTaskStatus,
  to: HubTaskStatus,
): Promise<HubActionResult> {
  try {
    const input = taskStatusSchema.parse({ workspaceId, taskId, from, to });
    if (!isValidHubTaskTransition(input.from, input.to)) {
      return {
        error: `Can't move a task from ${HUB_TASK_STATUS_LABELS[input.from]} to ${HUB_TASK_STATUS_LABELS[input.to]}.`,
      };
    }
    const user = await guard(input.workspaceId);
    const isDone = doneFromHubTaskStatus(input.to);

    const updated = await db
      .update(hubTasks)
      .set({
        done: isDone,
        completedAt: isDone ? new Date() : null,
      })
      .where(
        and(
          eq(hubTasks.workspaceId, input.workspaceId),
          eq(hubTasks.id, input.taskId),
          eq(hubTasks.done, doneFromHubTaskStatus(input.from)),
        ),
      )
      .returning({
        id: hubTasks.id,
        originRunStepId: hubTasks.originRunStepId,
      });

    if (updated.length === 0) {
      return {
        error:
          "This task already changed — refresh to see its latest status.",
      };
    }

    const originStepId = updated[0]?.originRunStepId;
    if (originStepId && isDone) {
      try {
        const [step] = await db
          .select({
            id: sopRunSteps.id,
            runId: sopRunSteps.runId,
            status: sopRunSteps.status,
          })
          .from(sopRunSteps)
          .where(
            and(
              eq(sopRunSteps.workspaceId, input.workspaceId),
              eq(sopRunSteps.id, originStepId),
            ),
          )
          .limit(1);

        if (
          step &&
          (step.status === "ready" || step.status === "in_progress")
        ) {
          await moveRunStep({
            workspaceId: input.workspaceId,
            runId: step.runId,
            stepId: step.id,
            userId: user.id,
            to: "done",
            expectFrom: [step.status],
          });
        }
      } catch {
        // Non-blocking: task status change already committed
      }
    }

    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const editTitleSchema = z.object({
  workspaceId: ws,
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
});

export async function editTaskTitleAction(
  workspaceId: string,
  taskId: string,
  title: string,
): Promise<HubActionResult> {
  try {
    const input = editTitleSchema.parse({ workspaceId, taskId, title });
    const user = await guard(input.workspaceId);
    await updateHubTaskTitle({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      title: input.title,
      actorId: user.id,
    });
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const taskActionSchema = z.object({
  workspaceId: ws,
  taskId: z.string().min(1),
});

export async function archiveTaskAction(
  workspaceId: string,
  taskId: string,
): Promise<HubActionResult> {
  try {
    const input = taskActionSchema.parse({ workspaceId, taskId });
    const user = await guard(input.workspaceId);
    await archiveHubTask({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      actorId: user.id,
    });
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

export async function reopenTaskAction(
  workspaceId: string,
  taskId: string,
): Promise<HubActionResult> {
  try {
    const input = taskActionSchema.parse({ workspaceId, taskId });
    const user = await guard(input.workspaceId);
    await reopenHubTask({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      actorId: user.id,
    });
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const taskPrioritySchema = z.object({
  workspaceId: ws,
  taskId: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]),
});

export async function setTaskPriority(
  workspaceId: string,
  taskId: string,
  priority: "high" | "medium" | "low",
): Promise<HubActionResult> {
  try {
    const input = taskPrioritySchema.parse({ workspaceId, taskId, priority });
    await guard(input.workspaceId);
    await setHubTaskPriority(input);
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const reminderSchema = z.object({
  workspaceId: ws,
  title: z.string().trim().min(1).max(300),
  dueAtIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "Invalid date",
  }),
});

export async function createReminder(
  workspaceId: string,
  title: string,
  dueAtIso: string,
): Promise<HubActionResult> {
  try {
    const input = reminderSchema.parse({ workspaceId, title, dueAtIso });
    const user = await guard(input.workspaceId);
    await addHubReminder({
      workspaceId: input.workspaceId,
      ownerId: user.id,
      title: input.title,
      dueAt: new Date(input.dueAtIso),
    });
    return await stateAfter(input.workspaceId, "reminders");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const planSchema = z.object({
  workspaceId: ws,
  ideaId: z.string().min(1),
  decision: z.enum(["accepted", "rejected"]),
});

export async function decidePlanIdea(
  workspaceId: string,
  ideaId: string,
  decision: "accepted" | "rejected",
): Promise<HubActionResult> {
  try {
    const input = planSchema.parse({ workspaceId, ideaId, decision });
    const user = await guard(input.workspaceId);
    if (input.decision === "accepted") {
      await acceptIdea({
        workspaceId: input.workspaceId,
        ideaId: input.ideaId,
        actorId: user.id,
      });
    } else {
      await rejectIdea(input.workspaceId, input.ideaId, null);
    }
    // This mutates the ideas/content rows the server-rendered Plan and
    // Production pages read, so invalidate them (a soft nav from Hub to /plan
    // would otherwise show the just-decided idea as still pending).
    revalidatePath(`/w/${input.workspaceId}/plan`);
    revalidatePath(`/w/${input.workspaceId}/production`);
    return await stateAfter(input.workspaceId, "plan");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
