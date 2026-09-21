import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { divergenceStage } from "@/lib/platina/stages/wire";

/**
 * Weekly backstop for the brand_divergence stage. Runs normally happen on
 * every detected change; this catches a workspace whose sources have been
 * quiet but whose brand standard or Brain moved. Each workspace is isolated:
 * one failing workspace is reported, never allowed to block the rest.
 */
export const platinaDivergenceScan = inngest.createFunction(
  {
    id: "platina-divergence-scan",
    triggers: [{ cron: "0 5 * * 1" }],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let produced = 0;
    const failed: string[] = [];
    for (const workspaceId of workspaceIds) {
      try {
        const result = await step.run(`divergence-${workspaceId}`, () =>
          divergenceStage(workspaceId),
        );
        if (result.status === "done") produced += result.produced;
      } catch {
        failed.push(workspaceId);
      }
    }
    return { produced, failed };
  },
);
