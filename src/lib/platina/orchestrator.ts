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

export type FetchStageResult = {
  /** Documents the actor returned (before dedupe). */
  fetched: number;
  /** Rows actually inserted after hash dedupe. */
  inserted: number;
  /** Targets that produced nothing usable. */
  failures: string[];
  /** Pages/posts the actors returned — what the daily cap is charged for. */
  pages?: number;
  /**
   * Things worth telling the operator that are NOT failures — e.g. a source
   * that had to be read with a browser. They appear on the run timeline and
   * never affect its status.
   */
  notes?: string[];
};

/**
 * An analysis stage either did its work or says why it could not. A stage that
 * throws degrades the run; a stage that legitimately has nothing to work on
 * yet (no brand standard, no evidence) skips with a reason and does not.
 */
export type StageResult =
  | { status: "done"; produced: number; note: string }
  | { status: "skipped"; reason: string };

export type OrchestratorDeps = {
  loadRun: (workspaceId: string, runId: string) => Promise<AuditRunRecord | null>;
  transition: (input: TransitionInput) => Promise<string | null>;
  /** The fetch stage: approved-spec registry fetch + deduped signal insert. */
  runFetchStage: (
    workspaceId: string,
    run: AuditRunRecord,
  ) => Promise<FetchStageResult>;
  /** Hands the new signal batch to the contradiction sweep. */
  dispatchContradiction: (workspaceId: string) => Promise<void>;
  /** Records the outcome on the source (freshness, adaptive cadence state). */
  recordSpecOutcome: (
    workspaceId: string,
    specId: string,
    outcome: { inserted: number; failed: boolean; pages?: number },
  ) => Promise<void>;
  /** brand_divergence: own-brand standard vs competitor-derived evidence. */
  runDivergenceStage?: (
    workspaceId: string,
    run: AuditRunRecord,
  ) => Promise<StageResult>;
  /** ideation: Brain evidence -> cited candidate directions. */
  runIdeationStage?: (
    workspaceId: string,
    run: AuditRunRecord,
  ) => Promise<StageResult>;
  broadcast: (workspaceId: string, runId: string) => Promise<void>;
};

/** Which dependency executes each stage. claims_screen has no executor yet;
 *  a stage without one is recorded as skipped with the reason — the run
 *  timeline says exactly what happened, never more. */
type StageKind = "fetch" | "divergence" | "ideation";
const STAGE_EXECUTORS: Partial<Record<PlatinaAnalysisStep, StageKind>> = {
  competitor_scan: "fetch",
  brand_divergence: "divergence",
  ideation: "ideation",
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
  const stageErrors: string[] = [];
  let fetchFailed: string | null = null;
  let fetchSkipped: string | null = null;
  let fetchFailures: string[] = [];
  let inserted = 0;
  let pages = 0;
  // Stages that actually did work. A run where none did must not read "completed".
  let executed = 0;

  for (const stage of run.configSnapshot.analysisSequence) {
    const executor = STAGE_EXECUTORS[stage];
    if (!executor) {
      stageNotes.push(`${stage}: skipped (no executor for this stage)`);
      continue;
    }

    if (executor === "fetch") {
      if (!run.specId) {
        fetchSkipped = "no audit source attached to this run";
        continue;
      }
      try {
        const result = await deps.runFetchStage(workspaceId, run);
        counters.fetched = (counters.fetched ?? 0) + result.fetched;
        counters.inserted = (counters.inserted ?? 0) + result.inserted;
        inserted += result.inserted;
        pages += result.pages ?? result.fetched;
        fetchFailures = result.failures;
        executed += 1;
        stageNotes.push(
          `${stage}: ${result.fetched} fetched, ${result.inserted} new` +
            (result.failures.length > 0
              ? `, ${result.failures.length} target(s) failed`
              : ""),
        );
        for (const note of result.notes ?? []) stageNotes.push(note);
      } catch (error) {
        fetchFailed = error instanceof Error ? error.message : "fetch failed";
      }
      continue;
    }

    // Analysis stages read what collection already produced; there is nothing
    // to analyse when this run's own fetch failed.
    if (fetchFailed) {
      stageNotes.push(`${stage}: skipped (fetch failed)`);
      continue;
    }
    const runStage =
      executor === "divergence" ? deps.runDivergenceStage : deps.runIdeationStage;
    if (!runStage) {
      stageNotes.push(`${stage}: skipped (stage not wired)`);
      continue;
    }
    try {
      const result = await runStage(workspaceId, run);
      if (result.status === "skipped") {
        stageNotes.push(`${stage}: skipped (${result.reason})`);
      } else {
        executed += 1;
        counters[stage] = (counters[stage] ?? 0) + result.produced;
        stageNotes.push(`${stage}: ${result.note}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "stage failed";
      stageErrors.push(`${stage} failed: ${reason}`);
      stageNotes.push(`${stage}: failed (${reason})`);
    }
  }

  if (run.specId) {
    await deps.recordSpecOutcome(workspaceId, run.specId, {
      inserted,
      failed: fetchFailed !== null,
      pages,
    });
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

  // Degraded means something that should have worked did not: no source
  // attached, targets that failed, a stage that threw, or a run where no stage
  // did any work at all. A stage that skipped for a stated, legitimate reason
  // (nothing to analyse yet) is not a degradation on its own.
  const degradedReason = fetchSkipped
    ? `fetch stage skipped: ${fetchSkipped}`
    : stageErrors.length > 0
      ? stageErrors.join("; ")
      : fetchFailures.length > 0
        ? `targets failed: ${fetchFailures.join("; ")}`
        : executed === 0
          ? "no analysis stage ran"
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
