import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { runConsolidation } from "@/lib/platina/learning-engine";

/**
 * Monthly consolidation (C8.5 T85.6, decision E5): on the 1st at 02:00 UTC,
 * for every workspace — merge near-duplicate Brain insights, retire the
 * unused and untrusted ones, snapshot the month's weights and write the
 * digest. Idempotent per month (the snapshot is claimed first), so a retry
 * or a hand run from the Learning page changes nothing twice.
 */
export const platinaConsolidate = inngest.createFunction(
  { id: "platina-consolidate", triggers: [{ cron: "0 2 1 * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () => listAllWorkspaceIds());
    const done: { workspaceId: string; applied: boolean; merged: number; retired: number }[] = [];
    for (const ws of workspaceIds) {
      const r = await step.run(`consolidate-${ws}`, async () => {
        const result = await runConsolidation(ws, { apply: true });
        return { workspaceId: ws, applied: result.applied, merged: result.digest.merged, retired: result.digest.retired };
      });
      done.push(r);
    }
    return { workspaces: done.length, applied: done.filter((d) => d.applied).length };
  },
);
