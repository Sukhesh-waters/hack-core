import { inngest } from "@/inngest/client";
import {
  getAuditRun,
  getScanSpec,
  insertSignalDocuments,
  recordFetchOutcome,
  transitionAuditRun,
} from "@/db/queries/platina";
import { runApprovedScan } from "@/lib/platina/fetch/registry";
import { backoffInterval, tightenInterval } from "@/lib/platina/fetch/schedule";
import { registerWatersAdapter } from "@/lib/platina/fetch/waters";
import {
  executeAuditRun,
  type AuditRunRecord,
} from "@/lib/platina/orchestrator";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";
import type { RunStatus } from "@/lib/platina/run-status";

registerWatersAdapter();

/**
 * Durable audit-run worker. The orchestrator owns the state machine; every
 * transition is a guarded DB write followed by a post-commit broadcast. The
 * whole execution is one Inngest step because it is idempotent per run id —
 * a retry replays into guarded no-ops, never duplicate writes.
 */
export const platinaAuditRun = inngest.createFunction(
  {
    id: "platina-audit-run",
    triggers: [{ event: "platina/audit-run.requested" }],
  },
  async ({ event, step }) => {
    const data = event.data as { runId?: string; workspaceId?: string };
    if (typeof data.runId !== "string" || typeof data.workspaceId !== "string") {
      return { skipped: "malformed event" };
    }
    const { runId, workspaceId } = data;

    return step.run(`execute-${runId}`, async () => {
      const outcome = await executeAuditRun(
        {
          loadRun: async (ws, id) => {
            const run = await getAuditRun(ws, id);
            if (!run) return null;
            return {
              id: run.id,
              workspaceId: run.workspaceId,
              specId: run.specId,
              status: run.status as RunStatus,
              configSnapshot: run.configSnapshot,
              counters: run.counters,
            } satisfies AuditRunRecord;
          },
          transition: (input) => transitionAuditRun(input),
          runFetchStage: async (ws, run) => {
            if (!run.specId) throw new Error("run has no audit source");
            const spec = await getScanSpec(ws, run.specId);
            if (!spec) throw new Error("audit source not found");
            if (spec.status !== "approved") {
              throw new Error("audit source is not approved");
            }
            const outcome = await runApprovedScan({
              id: spec.id,
              workspaceId: spec.workspaceId,
              status: spec.status,
              targets: spec.targets,
            });
            const inserted = await insertSignalDocuments(
              ws,
              spec.id,
              outcome.docs,
            );
            return {
              fetched: outcome.docs.length,
              inserted,
              failures: outcome.failures.map(
                (f) => `${f.target} (${f.error})`,
              ),
            };
          },
          dispatchContradiction: async (ws) => {
            await inngest.send({
              name: "platina/contradict.requested",
              data: { workspaceId: ws },
            });
          },
          recordSpecOutcome: (ws, specId, outcome) =>
            recordFetchOutcome(ws, specId, outcome, {
              tighten: tightenInterval,
              backoff: backoffInterval,
            }),
          broadcast: (ws, id) => broadcastPlatinaSignal(ws, "audits", id),
        },
        workspaceId,
        runId,
      );
      return outcome;
    });
  },
);
