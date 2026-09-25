import { inngest } from "@/inngest/client";
import { listOwnSiteClients } from "@/db/queries/platina-learning";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { ownSiteDeps as deps } from "@/lib/platina/own-site-deps";
import { runOwnSitePass } from "@/lib/platina/own-site-run";
import { backfillEmbeddings } from "@/lib/platina/learning-service";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

const READS_PER_STEP = 10;
/** 10 x 10 = 100 reads per client per run, above the default daily limit of 50. */
const MAX_BATCHES = 10;

/**
 * A client's own website into first-party knowledge (C6 L1). On request (a
 * client's site set or "read now") and daily. One pass per client at a time.
 */
export const platinaOwnSite = inngest.createFunction(
  {
    id: "platina-own-site",
    triggers: [{ event: "platina/own-site.requested" }, { cron: "0 5 * * *" }],
    concurrency: { key: "event.data.brandId", limit: 1 },
    debounce: { key: "event.data.brandId", period: "1m" },
  },
  async ({ event, step }) => {
    const data = (event?.data ?? {}) as { workspaceId?: string; brandId?: string; forceRemap?: boolean };
    const targets: { workspaceId: string; brandId: string }[] = [];
    if (typeof data.workspaceId === "string" && typeof data.brandId === "string") {
      targets.push({ workspaceId: data.workspaceId, brandId: data.brandId });
    } else {
      const workspaceIds = await step.run("list-workspaces", () => listAllWorkspaceIds());
      for (const ws of workspaceIds) {
        const clients = await step.run(`clients-${ws}`, () => listOwnSiteClients(ws));
        for (const c of clients) targets.push({ workspaceId: ws, brandId: c.id });
      }
    }
    const results = [];
    for (const t of targets) {
      // Batches of READS_PER_STEP keep each step well inside a function
      // timeout; later batches find the map and probes already done.
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const result = await step.run(`own-site-${t.brandId}-${batch}`, () =>
          runOwnSitePass(deps, {
            ...t,
            forceRemap: batch === 0 && data.forceRemap === true,
            maxReads: READS_PER_STEP,
          }),
        );
        results.push({ ...t, batch, result });
        if (result.status !== "done") break;
        if (result.read > 0 || result.added > 0 || result.gone > 0) {
          await step.run(`broadcast-${t.brandId}-${batch}`, () =>
            broadcastPlatinaSignal(t.workspaceId, "knowledge"),
          );
        }
        // A rate limit ends today's reads for this client; tomorrow continues.
        if (result.rateLimited) break;
        const attempted = result.read + result.unchanged + result.failed;
        if (attempted < READS_PER_STEP || result.budgetLeft === 0) break;
        await step.sleep(`pace-${t.brandId}-${batch}`, "20s");
      }
    }
    // Passages stored during an embedding outage become retrievable here, or
    // on the daily learning job, as soon as the provider allows.
    const workspaces = Array.from(new Set(targets.map((t) => t.workspaceId)));
    for (const ws of workspaces) await step.run(`embed-${ws}`, () => backfillEmbeddings(ws));
    return results;
  },
);
