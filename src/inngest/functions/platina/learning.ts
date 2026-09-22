import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { backfillEmbeddings, openDueReviews } from "@/lib/platina/learning-service";
import { syncConnectedMetrics } from "@/lib/platina/metrics-connected";

/**
 * The learning loop's clock (C6 L3-L4). Daily: read post metrics from
 * connected accounts (read-only). When numbers are saved, and daily: open a
 * drafted review for every creative that is due, and embed
 * any lesson stored during an embedding outage. Confirming a review (the step
 * that makes the system learn) is always a person's action, never this job.
 */
export const platinaLearning = inngest.createFunction(
  {
    id: "platina-learning",
    triggers: [{ event: "platina/results.updated" }, { cron: "0 6 * * *" }],
    concurrency: { key: "event.data.workspaceId", limit: 1 },
    debounce: { key: "event.data.workspaceId", period: "30s" },
  },
  async ({ event, step }) => {
    const data = (event?.data ?? {}) as { workspaceId?: string; brandId?: string | null };
    const workspaceIds =
      typeof data.workspaceId === "string"
        ? [data.workspaceId]
        : await step.run("list-workspaces", () => listAllWorkspaceIds());
    const daily = typeof data.workspaceId !== "string";
    const out: { workspaceId: string; opened: number; embedded: number; connected?: unknown }[] = [];
    for (const ws of workspaceIds) {
      const connected = daily ? await step.run(`connected-${ws}`, () => syncConnectedMetrics(ws)) : undefined;
      const opened = await step.run(`reviews-${ws}`, () => openDueReviews(ws, data.brandId ?? null));
      const embedded = await step.run(`embed-${ws}`, () => backfillEmbeddings(ws));
      out.push({ workspaceId: ws, opened, embedded, connected });
    }
    return out;
  },
);
