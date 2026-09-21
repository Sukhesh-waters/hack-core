import { inngest } from "@/inngest/client";
import {
  createAuditRun,
  getScanSpec,
  getWorkspaceConfig,
  getWorkspacePagesToday,
  recordProbeState,
  transitionAuditRun,
} from "@/db/queries/platina";
import { probeSource } from "@/lib/platina/fetch/probe";
import { headProbeFetch } from "@/lib/platina/fetch/probe-fetch";
import {
  ADAPTIVE_START_MINUTES,
  DAILY_CAP_REASON,
  SOURCE_CAP_REASON,
  costCapReached,
  isDue,
  workspacePagesRemaining,
} from "@/lib/platina/fetch/schedule";
import { snapshotRunConfig } from "@/lib/platina/orchestrator";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Tier-1 probe worker (R1). For probe-capable sources: a cheap conditional
 * request decides whether a paid actor run is warranted. For probe-less
 * sources: the adaptive cadence decides directly. A run is created only when
 * content likely changed — daily actor invocations track observed changes,
 * not cadence × sources.
 */
export const platinaProbeTick = inngest.createFunction(
  {
    id: "platina-probe-tick",
    triggers: [{ event: "platina/probe.tick" }],
  },
  async ({ event, step }) => {
    const data = event.data as {
      specId?: string;
      workspaceId?: string;
      tick?: string;
      probeCapable?: boolean;
    };
    if (typeof data.specId !== "string" || typeof data.workspaceId !== "string") {
      return { skipped: "malformed event" };
    }
    const { specId, workspaceId } = data;
    const tick = data.tick ?? new Date().toISOString().slice(0, 16);

    const spec = await step.run("load-spec", () =>
      getScanSpec(workspaceId, specId),
    );
    if (!spec || spec.status !== "approved" || !spec.enabled) {
      return { skipped: "not approved or disabled" };
    }
    const targetUrl = spec.targets[0]?.value;
    if (!targetUrl) return { skipped: "no target" };

    const today = new Date().toISOString().slice(0, 10);
    const config = await step.run("load-config", () =>
      getWorkspaceConfig(workspaceId),
    );
    const pagesToday = await step.run("pages-today", () =>
      getWorkspacePagesToday(workspaceId, today),
    );

    // Spend control. A pause is never silent: it is recorded as a degraded run
    // with its reason, once per source per day (per workspace for the workspace
    // cap), so the Audits timeline and the cockpit can say why collection stopped.
    const sourceCapped = costCapReached(spec);
    const workspaceCapped =
      workspacePagesRemaining(pagesToday, config?.dailyActorCallCap ?? 40) === 0;
    if (sourceCapped || workspaceCapped) {
      const reason = workspaceCapped ? DAILY_CAP_REASON : SOURCE_CAP_REASON;
      const key = workspaceCapped
        ? `cap-pause:workspace:${today}`
        : `cap-pause:${specId}:${today}`;
      const pausedRunId = await step.run("record-pause", async () => {
        const id = await createAuditRun({
          workspaceId,
          specId: workspaceCapped ? null : specId,
          trigger: "schedule",
          idempotencyKey: key,
          configSnapshot: snapshotRunConfig(config),
        });
        if (!id) return null; // already recorded today
        await transitionAuditRun({
          workspaceId,
          runId: id,
          from: ["queued"],
          to: "running",
          message: "Paused by the daily collection cap",
        });
        await transitionAuditRun({
          workspaceId,
          runId: id,
          from: ["running"],
          to: "degraded",
          message: reason,
          degradedReason: reason,
        });
        return id;
      });
      if (pausedRunId) {
        await broadcastPlatinaSignal(workspaceId, "audits", pausedRunId);
      }
      return { skipped: reason };
    }

    if (data.probeCapable) {
      const probe = await step.run("probe", () =>
        probeSource(
          targetUrl,
          { etag: spec.probeEtag, lastModified: spec.probeLastModified },
          headProbeFetch,
        ),
      );
      if (probe.outcome === "unchanged") {
        await step.run("record-unchanged", () =>
          recordProbeState(workspaceId, specId, {}),
        );
        return { probed: "unchanged" };
      }
      if (probe.outcome === "unsupported") {
        // No cheap signal on this source — switch it to adaptive cadence.
        await step.run("record-unsupported", () =>
          recordProbeState(workspaceId, specId, {
            currentIntervalMinutes:
              spec.currentIntervalMinutes ?? ADAPTIVE_START_MINUTES,
          }),
        );
        if (!isDue(spec, false)) return { probed: "unsupported-not-due" };
      }
      if (probe.outcome === "changed") {
        await step.run("record-validators", () =>
          recordProbeState(workspaceId, specId, {
            etag: probe.etag,
            lastModified: probe.lastModified,
          }),
        );
      }
    } else if (!isDue(spec, false)) {
      return { skipped: "not due" };
    }

    // Changed (or adaptively due): create the run and dispatch the worker.
    const runId = await step.run("create-run", () =>
      createAuditRun({
        workspaceId,
        specId,
        trigger: "schedule",
        idempotencyKey: `schedule:${specId}:${tick}`,
        configSnapshot: snapshotRunConfig(config),
      }),
    );
    if (!runId) return { skipped: "run already exists for this tick" };

    await step.sendEvent("dispatch", {
      name: "platina/audit-run.requested",
      data: { runId, workspaceId },
    });
    await broadcastPlatinaSignal(workspaceId, "audits", runId);
    return { runId };
  },
);
