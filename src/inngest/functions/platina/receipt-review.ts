import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { dueReceiptsQuery } from "@/db/queries/platina";

export const platinaReceiptReview = inngest.createFunction(
  {
    id: "platina-receipt-review",
    triggers: [{ cron: "0 9 * * *" }],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let due = 0;
    for (const workspaceId of workspaceIds) {
      const rows = await step.run(`due-${workspaceId}`, () =>
        dueReceiptsQuery(workspaceId, new Date()),
      );
      due += rows.length;
    }
    return { due };
  },
);
