import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { listBrandChunks } from "@/db/queries/platina";

export const platinaDivergenceScan = inngest.createFunction(
  {
    id: "platina-divergence-scan",
    triggers: [{ cron: "0 5 * * 1" }],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let scanned = 0;
    for (const workspaceId of workspaceIds) {
      const chunks = await step.run(`brand-${workspaceId}`, () =>
        listBrandChunks(workspaceId),
      );
      scanned += chunks.length;
    }
    return { scanned };
  },
);
