import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { hubMessages } from "@/db/schema";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { listDueForReview, markReviewSurfaced } from "@/db/queries/decisions";

/**
 * G2 — daily sweep: find decisions whose review date has arrived and
 * haven't been surfaced yet, post one Team Hub system message per decision,
 * stamp reviewSurfacedAt so tomorrow's run doesn't repeat the same reminder.
 *
 * This job MUST NEVER set an outcome (I7 — human governs, AI proposes; here
 * there isn't even an AI in the loop, just a reminder). It surfaces; a human
 * judges via recordDecisionOutcomeAction on the Decisions page.
 *
 * Per-decision try/catch, matching pattern-scan.ts and the account-sync
 * sweep: one failing row must never abort the rest of the batch.
 */
export const decisionReview = inngest.createFunction(
  { id: "decision-review", triggers: [{ cron: "0 9 * * *" }] },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );

    let surfaced = 0;
    for (const workspaceId of workspaceIds) {
      const due = await step.run(`due-${workspaceId}`, () =>
        listDueForReview(workspaceId, new Date()),
      );
      const unsurfaced = due.filter((d) => !d.reviewSurfacedAt);

      for (const decision of unsurfaced) {
        await step.run(`surface-${decision.id}`, async () => {
          try {
            await db.insert(hubMessages).values({
              workspaceId,
              kind: "system",
              body: `Decision due for review: "${decision.title}" — expected: ${decision.expectedOutcome}`,
            });
            await markReviewSurfaced({
              workspaceId,
              decisionId: decision.id,
              at: new Date(),
            });
          } catch (error) {
            console.error(
              `decision-review: failed to surface ${decision.id}:`,
              error,
            );
            return;
          }
        });
        surfaced += 1;
      }
    }

    return { surfaced };
  },
);
