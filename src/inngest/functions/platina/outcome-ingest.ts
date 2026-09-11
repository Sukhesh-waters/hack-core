import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { listOutcomes } from "@/db/queries/platina";

export const platinaOutcomeIngest = inngest.createFunction(
  {
    id: "platina-outcome-ingest",
    triggers: [{ cron: "0 2 * * *" }],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let counted = 0;
    for (const workspaceId of workspaceIds) {
      const rows = await step.run(`outcomes-${workspaceId}`, () =>
        listOutcomes(workspaceId),
      );
      counted += rows.length;
    }
    return { counted };
  },
);
