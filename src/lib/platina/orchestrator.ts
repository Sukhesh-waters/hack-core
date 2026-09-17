/**
 * Audit-run orchestrator. Snapshots the workspace's analysis configuration
 * onto the run at creation (later config edits cannot rewrite history), then
 * executes the snapshotted stages with bounded, guarded transitions.
 *
 * The core is dependency-injected: production wiring passes the real Drizzle
 * queries and the Realtime broadcaster; tests pass fakes. No module here
 * touches the database directly.
 */
import type {
  PlatinaRunConfigSnapshot,
  PlatinaAnalysisStep,
} from "@/db/platina-schema";
import {
  canTransition,
  isTerminal,
  type RunStatus,
} from "./run-status";

export type AuditRunRecord = {
  id: string;
  workspaceId: string;
  specId: string | null;
  status: RunStatus;
  configSnapshot: PlatinaRunConfigSnapshot;
  counters: Record<string, number>;
};

export type TransitionInput = {
  workspaceId: string;
  runId: string;
  from: readonly RunStatus[];
  to: RunStatus;
  message?: string;
  payload?: Record<string, unknown>;
  counters?: Record<string, number>;
  errorReason?: string;
  degradedReason?: string;
};

export type OrchestratorDeps = {
  loadRun: (workspaceId: string, runId: string) => Promise<AuditRunRecord | null>;
  transition: (input: TransitionInput) => Promise<string | null>;
  /** The fetch stage: approved-spec registry fetch + signal insert. */
  runFetchStage: (
    workspaceId: string,
    run: AuditRunRecord,
  ) => Promise<{ fetched: number }>;
  /** Hands the new signal batch to the contradiction sweep. */
  dispatchContradiction: (workspaceId: string) => Promise<void>;
  markSpecRun: (workspaceId: string, specId: string) => Promise<void>;
  broadcast: (workspaceId: string, runId: string) => Promise<void>;
};

/** Stages with a real executor in Slice 2. Anything else is recorded as
 *  skipped with the slice that will implement it — the run timeline says
 *  exactly what happened, never more. */
const STAGE_EXECUTORS: Partial<Record<PlatinaAnalysisStep, "fetch">> = {
  competitor_scan: "fetch",
};

const STAGE_DEFERRED_TO: Partial<Record<PlatinaAnalysisStep, string>> = {
  brand_divergence: "Slice 8",
  ideation: "Slice 5",
  claims_screen: "Slice 8",
};

/** Freeze the effective config onto the run. Defaults match the schema. */
export function snapshotRunConfig(config: {
  analysisSequence?: PlatinaAnalysisStep[];
  promptVersion?: number;
  minBaselineN?: number;
  contestedFloor?: number;
  qualifiedFloor?: number;
} | null): PlatinaRunConfigSnapshot {
  return {
    // Copied — a snapshot that aliases the live config array is not a snapshot.
    analysisSequence: [
      ...(config?.analysisSequence ?? [
        "competitor_scan",
        "brand_divergence",
        "ideation",
      ]),
    ],
    promptVersion: config?.promptVersion ?? 1,
    minBaselineN: config?.minBaselineN ?? 20,
    contestedFloor: config?.contestedFloor ?? 0.4,
    qualifiedFloor: config?.qualifiedFloor ?? 0.7,
  };
}

/** Minute-bucketed key: a double-click within the minute replays harmlessly. */
export function manualIdempotencyKey(specId: string, now = new Date()): string {
  const bucket = now.toISOString().slice(0, 16);
  return `manual:${specId}:${bucket}`;
}

export type RunOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "completed"; counters: Record<string, number> }
  | { outcome: "degraded"; reason: string; counters: Record<string, number> }
  | { outcome: "failed"; reason: string };

export async function executeAuditRun(
  deps: OrchestratorDeps,
  workspaceId: string,
  runId: string,
): Promise<RunOutcome> {
  const run = await deps.loadRun(workspaceId, runId);
  if (!run) return { outcome: "skipped", reason: "run not found" };
  if (isTerminal(run.status)) {
    return { outcome: "skipped", reason: `run already ${run.status}` };
  }

  // queued → running. A null guard means another worker holds the run.
  const started = await deps.transition({
    workspaceId,
    runId,
    from: ["queued"],
    to: "running",
    message: "Run started",
  });
  if (!started) {
    return { outcome: "skipped", reason: "run not pickable" };
  }
  await deps.broadcast(workspaceId, runId);

  const counters: Record<string, number> = { ...run.counters };
  const stageNotes: string[] = [];
  let fetchFailed: string | null = null;
  let fetchSkipped: string | null = null;

  for (const stage of run.configSnapshot.analysisSequence) {
    const executor = STAGE_EXECUTORS[stage];
    if (!executor) {
      stageNotes.push(
        `${stage}: skipped (lands in ${STAGE_DEFERRED_TO[stage] ?? "a later slice"})`,
      );
      continue;
    }
    if (!run.specId) {
      fetchSkipped = "no audit source attached to this run";
      continue;
    }
    try {
      const result = await deps.runFetchStage(workspaceId, run);
      counters.fetched = (counters.fetched ?? 0) + result.fetched;
      stageNotes.push(`${stage}: ${result.fetched} documents fetched`);
    } catch (error) {
      fetchFailed = error instanceof Error ? error.message : "fetch failed";
    }
  }

  if (fetchFailed) {
    await deps.transition({
      workspaceId,
      runId,
      from: ["running"],
      to: "failed",
      message: "Fetch stage failed",
      errorReason: fetchFailed,
      counters,
    });
    await deps.broadcast(workspaceId, runId);
    return { outcome: "failed", reason: fetchFailed, };
  }

  // running → validating: hand the new batch to the contradiction sweep.
  const validating = await deps.transition({
    workspaceId,
    runId,
    from: ["running"],
    to: "validating",
    message: stageNotes.join("; ") || "no stages configured",
    counters,
  });
  if (!validating) return { outcome: "skipped", reason: "run lost mid-flight" };
  await deps.broadcast(workspaceId, runId);
  if ((counters.fetched ?? 0) > 0) {
    await deps.dispatchContradiction(workspaceId);
  }

  // Deferred stages are the expected V1 shape, not a degradation. Degraded
  // means something that should have worked did not — in Slice 2, a run with
  // no source attached to fetch from.
  const degradedReason = fetchSkipped
    ? `fetch stage skipped: ${fetchSkipped}`
    : null;

  await deps.transition({
    workspaceId,
    runId,
    from: ["validating"],
    to: degradedReason ? "degraded" : "completed",
    message: degradedReason ?? "Run completed",
    degradedReason: degradedReason ?? undefined,
    counters,
  });
  if (run.specId) await deps.markSpecRun(workspaceId, run.specId);
  await deps.broadcast(workspaceId, runId);

  return degradedReason
    ? { outcome: "degraded", reason: degradedReason, counters }
    : { outcome: "completed", counters };
}

/** Guard used by callers creating a run: only approved specs may execute. */
export function assertRunnableSpecStatus(status: string): void {
  if (status !== "approved") {
    throw new Error("audit source is not approved — a run cannot start");
  }
}

export { canTransition, isTerminal };
