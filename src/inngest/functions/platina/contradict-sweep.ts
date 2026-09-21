import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import {
  countTranscriptsSince,
  getWorkspaceConfig,
  insertFinding,
  listDebateTranscripts,
  listOpenOperationalFindings,
  listUnresolvedSignals,
} from "@/db/queries/platina";
import {
  analysisBatchSize,
  analyzeEventId,
} from "@/lib/platina/analysis";
import {
  OBJECTION_RATE_CEILING,
  OBJECTION_WINDOW,
  objectionCeilingExceeded,
  objectionRate,
} from "@/lib/platina/objection-rate";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Contradiction sweep — the dispatcher. Triggered by a new signal batch (event
 * carries the workspace) or by the 6-hour cron backstop over all workspaces.
 * It fans out one `platina/signal.analyze` event per unprocessed document,
 * newest first, bounded by the workspace's daily analysis cap; the analysis
 * itself (debate -> finding / Brain chunk) lives in signal-analyze.ts so it
 * runs concurrently and retries per signal.
 *
 * R5.1: after each workspace's dispatch, the objection rate over the recent
 * transcript window is computed; a ceiling breach raises one open
 * operational finding against the current prompt version.
 */
export const platinaContradictSweep = inngest.createFunction(
  {
    id: "platina-contradict-sweep",
    triggers: [
      { cron: "30 */6 * * *" },
      { event: "platina/contradict.requested" },
    ],
  },
  async ({ event, step }) => {
    const data = (event as { data?: Record<string, unknown> } | undefined)?.data;
    const requestedWorkspace =
      typeof data?.workspaceId === "string" ? data.workspaceId : null;

    const workspaceIds = requestedWorkspace
      ? [requestedWorkspace]
      : await step.run("list-workspaces", () => listAllWorkspaceIds());

    let dispatched = 0;
    for (const workspaceId of workspaceIds) {
      const startOfDay = new Date(
        `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
      );
      const analysedToday = await step.run(`analysed-today-${workspaceId}`, () =>
        countTranscriptsSince(workspaceId, startOfDay),
      );
      const budget = analysisBatchSize(analysedToday);
      if (budget > 0) {
        const signals = await step.run(`signals-${workspaceId}`, () =>
          listUnresolvedSignals(workspaceId, budget),
        );
        if (signals.length > 0) {
          await step.sendEvent(
            `dispatch-${workspaceId}`,
            signals.map((signal) => ({
              id: analyzeEventId(signal.id),
              name: "platina/signal.analyze",
              data: { workspaceId, signalId: signal.id },
            })),
          );
          dispatched += signals.length;
        }
      }

      // R5.1 — objection-rate telemetry against the prompt version.
      const config = await step.run(`config-${workspaceId}`, () =>
        getWorkspaceConfig(workspaceId),
      );
      const rounds = await step.run(`objection-window-${workspaceId}`, () =>
        listDebateTranscripts(workspaceId, OBJECTION_WINDOW),
      );
      if (objectionCeilingExceeded(rounds.map((r) => ({ state: r.state })))) {
        const open = await step.run(`operational-open-${workspaceId}`, () =>
          listOpenOperationalFindings(workspaceId),
        );
        if (open.length === 0) {
          const rate = objectionRate(rounds.map((r) => ({ state: r.state })));
          await step.run(`operational-finding-${workspaceId}`, () =>
            insertFinding({
              workspaceId,
              useCase: "operational",
              title: "Validation layer objection rate elevated",
              summary:
                `${Math.round(rate * 100)}% of the last ${rounds.length} ` +
                `validation rounds ended contested or refuted — above the ` +
                `${Math.round(OBJECTION_RATE_CEILING * 100)}% ceiling. This is an ` +
                `operational signal about prompt version ${config?.promptVersion ?? 1}, ` +
                `not about any single claim.`,
              strongestObjection:
                "A challenger that objects to nearly everything carries no information.",
              status: "needs_decision",
            }),
          );
          await broadcastPlatinaSignal(workspaceId, "findings");
        }
      }
    }
    return { dispatched };
  },
);
