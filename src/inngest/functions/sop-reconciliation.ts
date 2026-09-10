import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { content, sopRunSteps, tickets } from "@/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { moveRunStep, OPEN_STEP_STATUSES } from "@/db/queries/sop";
import { broadcastSignal } from "@/lib/realtime";

/**
 * 15-minute micro-reconciliation sweep:
 * Scans open SOP run steps that have declarative completion policies (`completesWhen`)
 * and cross-references them against actual database state. Repairs any missed event
 * transitions idempotently.
 */
export const sopReconciliation = inngest.createFunction(
  {
    id: "sop-reconciliation",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const candidateSteps = await step.run("fetch-candidates", async () => {
      return db
        .select({
          id: sopRunSteps.id,
          workspaceId: sopRunSteps.workspaceId,
          runId: sopRunSteps.runId,
          linkedType: sopRunSteps.linkedType,
          linkedId: sopRunSteps.linkedId,
          completesWhen: sopRunSteps.completesWhen,
        })
        .from(sopRunSteps)
        .where(
          and(
            inArray(sopRunSteps.status, [...OPEN_STEP_STATUSES] as never[]),
            isNotNull(sopRunSteps.linkedId),
          ),
        );
    });

    let repaired = 0;
    const touchedWorkspaces = new Set<string>();

    for (const candidate of candidateSteps) {
      if (!candidate.linkedId || candidate.completesWhen.kind === "manual") continue;

      let shouldComplete = false;

      if (candidate.linkedType === "content" && candidate.completesWhen.kind === "linked_state") {
        const targetState = candidate.completesWhen.state;
        const [contentRow] = await db
          .select({ status: content.productionStage })
          .from(content)
          .where(
            and(
              eq(content.workspaceId, candidate.workspaceId),
              eq(content.id, candidate.linkedId),
            ),
          )
          .limit(1);

        if (contentRow && contentRow.status === targetState) {
          shouldComplete = true;
        }
      } else if (candidate.linkedType === "ticket" && candidate.completesWhen.kind === "linked_closed") {
        const [ticketRow] = await db
          .select({ status: tickets.status })
          .from(tickets)
          .where(
            and(
              eq(tickets.workspaceId, candidate.workspaceId),
              eq(tickets.id, candidate.linkedId),
            ),
          )
          .limit(1);

        if (ticketRow && ticketRow.status === "done") {
          shouldComplete = true;
        }
      }

      if (shouldComplete) {
        await step.run(`repair-step-${candidate.id}`, async () => {
          const res = await moveRunStep({
            workspaceId: candidate.workspaceId,
            runId: candidate.runId,
            stepId: candidate.id,
            userId: "reconciliation",
            to: "done",
            expectFrom: OPEN_STEP_STATUSES,
          });

          if (res.ok) {
            repaired++;
            touchedWorkspaces.add(candidate.workspaceId);
          }
        });
      }
    }

    for (const ws of touchedWorkspaces) {
      void broadcastSignal(ws, "sop");
    }

    return { candidates: candidateSteps.length, repaired };
  },
);
