import { inngest } from "@/inngest/client";
import { BURST_WINDOW_MS, REPLAYED_TICK, isReplayedTick } from "@/lib/platina/cron-guard";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { listOutcomes } from "@/db/queries/platina";

export const platinaOutcomeIngest = inngest.createFunction(
  {
    id: "platina-outcome-ingest",
    triggers: [{ cron: "0 2 * * *" }],
  },
  async ({ event, runId, step }) => {
    if (isReplayedTick({ jobId: "platina-outcome-ingest", eventName: event.name, runId, minGapMs: BURST_WINDOW_MS })) {
      return REPLAYED_TICK;
    }
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
