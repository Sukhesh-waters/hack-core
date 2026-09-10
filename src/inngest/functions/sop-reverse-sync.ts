import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { sopRunSteps } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { moveRunStep, OPEN_STEP_STATUSES } from "@/db/queries/sop";
import { broadcastSignal } from "@/lib/realtime";

/**
 * Reactive SOP reverse-sync: listens to domain events from content and tickets.
 * When a linked object reaches its target completion state, the corresponding
 * SOP step is automatically advanced to `done`, unblocking downstream steps.
 */
export const sopReverseSync = inngest.createFunction(
  {
    id: "sop-reverse-sync",
    triggers: [
      { event: "domain/content.state_changed" },
      { event: "domain/content.published" },
      { event: "domain/ticket.closed" },
    ],
  },
  async ({ event, step }) => {
    const { workspaceId, subjectType, subjectId, verb } = event.data;
    if (!workspaceId || !subjectId) return { processed: 0 };

    const matchingSteps = await step.run("fetch-linked-steps", async () => {
      return db
        .select({
          id: sopRunSteps.id,
          runId: sopRunSteps.runId,
          completesWhen: sopRunSteps.completesWhen,
          status: sopRunSteps.status,
        })
        .from(sopRunSteps)
        .where(
          and(
            eq(sopRunSteps.workspaceId, workspaceId),
            eq(sopRunSteps.linkedType, subjectType),
            eq(sopRunSteps.linkedId, subjectId),
            inArray(sopRunSteps.status, [...OPEN_STEP_STATUSES] as never[]),
          ),
        );
    });

    let completedCount = 0;

    for (const stepItem of matchingSteps) {
      const policy = stepItem.completesWhen;
      let shouldComplete = false;

      if (policy.kind === "linked_closed" && verb === "ticket.closed") {
        shouldComplete = true;
      } else if (policy.kind === "linked_state") {
        const targetState = policy.state;
        if (verb === "content.published" && targetState === "published") {
          shouldComplete = true;
        } else if (verb === "content.state_changed" && event.data.to === targetState) {
          shouldComplete = true;
        }
      }

      if (shouldComplete) {
        await step.run(`complete-step-${stepItem.id}`, async () => {
          const res = await moveRunStep({
            workspaceId,
            runId: stepItem.runId,
            stepId: stepItem.id,
            userId: event.data.actorId ?? "system",
            to: "done",
            expectFrom: OPEN_STEP_STATUSES,
          });
          if (res.ok) {
            completedCount++;
            void broadcastSignal(workspaceId, "sop");
          }
        });
      }
    }

    return { processed: matchingSteps.length, completed: completedCount };
  },
);
