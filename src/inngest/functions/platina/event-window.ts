import { inngest } from "@/inngest/client";
import { campaignsQuery } from "@/db/queries/platina";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";

/**
 * Thin campaign→SOP-run reminder. Instantiation of pre/at/post offsets
 * reuses sop_steps.due_offset_days + instantiateRun — this job only
 * flags campaigns whose event anchor is approaching.
 */
export const platinaEventWindow = inngest.createFunction(
  {
    id: "platina-event-window",
    triggers: [{ cron: "0 6 * * *" }],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let opening = 0;
    const now = Date.now();
    for (const workspaceId of workspaceIds) {
      const campaigns = await step.run(`campaigns-${workspaceId}`, () =>
        campaignsQuery(workspaceId),
      );
      for (const campaign of campaigns) {
        if (!campaign.eventAnchor) continue;
        // step.run serialises timestamps to strings on the way out.
        const delta = new Date(campaign.eventAnchor).getTime() - now;
        const days = delta / 86_400_000;
        if (days <= 14 && days >= -7) opening += 1;
      }
    }
    return { opening };
  },
);
