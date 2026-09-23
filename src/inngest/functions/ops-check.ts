import { randomUUID } from "node:crypto";
import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import {
  ensureOpsAlertRule,
  insertOpsChecks,
  latestOpsChecks,
  OPS_RETENTION_DAYS,
  pruneOpsChecksQuery,
} from "@/db/queries/platina-ops";
import { newlyRed, opsTotals } from "@/lib/ops/checks";
import { readAccountUsage, runOpsChecks } from "@/lib/ops/collect";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * The ops board's clock (C7.1). Hourly, and on demand ("Run checks now"):
 * runs every check for every workspace (lib/ops, read-only), stores the run
 * for the 7-day history, and broadcasts `ops` so an open board refreshes.
 * Account usage (Apify, Firecrawl) is read once per run, not per workspace.
 * A check that has just turned red sends the alert sweep at once; the
 * default "a flow is red" rule is created on first run and can be edited.
 */
export const opsCheck = inngest.createFunction(
  {
    id: "ops-check",
    triggers: [{ cron: "15 * * * *" }, { event: "ops/check.requested" }],
    concurrency: { limit: 1 },
    debounce: { period: "20s", key: "event.data.workspaceId" },
  },
  async ({ event, step }) => {
    const data = (event?.data ?? {}) as { workspaceId?: string };
    const workspaceIds =
      typeof data.workspaceId === "string"
        ? [data.workspaceId]
        : await step.run("list-workspaces", () => listAllWorkspaceIds());
    const account = await step.run("account-usage", () => readAccountUsage());
    // step.run serialises dates to strings; restore them for the projections.
    const readings = account.map((r) =>
      "error" in r ? r : { ...r, periodStart: new Date(r.periodStart), periodEnd: new Date(r.periodEnd) },
    );

    const summary: { workspaceId: string; red: number; amber: number; newlyRed: string[] }[] = [];
    for (const workspaceId of workspaceIds) {
      const result = await step.run(`checks-${workspaceId}`, async () => {
        const previous = await latestOpsChecks(workspaceId);
        const checks = await runOpsChecks(workspaceId, { account: readings });
        const runId = randomUUID();
        const checkedAt = new Date();
        await insertOpsChecks(
          checks.map((c) => ({
            workspaceId,
            checkId: c.id,
            label: c.label,
            status: c.status,
            detail: c.detail,
            remedy: c.remedy ?? null,
            value: c.value ?? null,
            runId,
            checkedAt,
          })),
        );
        await pruneOpsChecksQuery(workspaceId, new Date(Date.now() - OPS_RETENTION_DAYS * 86_400_000));
        await ensureOpsAlertRule(workspaceId);
        const totals = opsTotals(checks);
        return { red: totals.redChecks, amber: totals.amberChecks, newlyRed: newlyRed(previous, checks).map((c) => c.id) };
      });
      await step.run(`broadcast-${workspaceId}`, () => broadcastPlatinaSignal(workspaceId, "ops"));
      summary.push({ workspaceId, ...result });
    }

    if (summary.some((s) => s.newlyRed.length > 0)) {
      await step.sendEvent("alert-now", { name: "platina/alerts.sweep.requested", data: {} });
    }
    return summary;
  },
);
