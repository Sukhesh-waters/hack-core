import { inngest } from "@/inngest/client";
import {
  applyScoreUpdates,
  listPostsMissingEmbeddings,
  listScorablePosts,
} from "@/db/queries/rescore";
import { embedPosts } from "@/lib/embed-posts";
import { buildRescorePlan } from "@/lib/rescore";

/**
 * Learning-loop sweep (W7): fired after publish-back results land. Rescores
 * every first-party row against the grown baseline (per client) and
 * backfills missing embeddings. Embedding failure degrades — rows stand
 * without vectors.
 */
export const rescoreSweep = inngest.createFunction(
  { id: "rescore", triggers: [{ event: "posts/rescore.requested" }] },
  async ({ event, step }) => {
    const workspaceId =
      typeof event.data?.workspaceId === "string"
        ? event.data.workspaceId
        : null;
    if (!workspaceId) return { skipped: "no workspaceId on event" };

    const rescored = await step.run("rescore", async () => {
      const rows = await listScorablePosts(workspaceId);
      const plan = buildRescorePlan(rows);
      await applyScoreUpdates(plan);
      return plan.length;
    });

    const embedded = await step.run("embed-missing", async () => {
      const missing = await listPostsMissingEmbeddings(workspaceId);
      return embedPosts(workspaceId, missing);
    });

    return { rescored, embedded };
  },
);
