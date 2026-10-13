/**
 * Brain funnel telemetry (B0 — metacognitive Brain). Stage "analysis" records
 * why a document did or did not reach a model call — the before-number the
 * rest of the plan measures improvement against (plan §0, §8 "Model-call
 * share"). Later stages (B1–B7) write their own decisions to the same table,
 * `platina_brain_telemetry`.
 *
 * `recordBrainEvent` mirrors suggestions-record.ts: fire-and-forget, catches
 * everything, never throws, never blocks the job or page it is called from.
 */
import type { BrainStage } from "./brain-modes";

/**
 * Stage "analysis" decisions — every exit `analysis-plan.ts` has today
 * (own_brand, low_value, nothing_new, analysed), plus the exits later stages
 * add (untestable: B1/B3, gate: B3, surprise/audit_sample: B4).
 */
export const ANALYSIS_DECISIONS = [
  "own_brand",
  "low_value",
  "nothing_new",
  "analysed",
  "untestable",
  "gate",
  "surprise",
  "audit_sample",
] as const;
export type AnalysisDecision = (typeof ANALYSIS_DECISIONS)[number];

export type BrainFunnelRow = { stage: string; decision: string; count: number };

export type BrainFunnelSummary = {
  /** Total documents fetched in the window, when the caller supplies it. */
  fetched?: number;
  /** Rows that reached (or stood in for reaching) a model call: analysed + audit_sample. */
  analysed: number;
  /** Everything else, by decision. */
  stoppedBy: Record<string, number>;
  /** analysed / fetched; null when fetched was not supplied — "not measured", never guessed. */
  modelCallShare: number | null;
};

const REACHED_MODEL = new Set<string>(["analysed", "audit_sample"]);

/** Pure arithmetic over already-grouped counts (e.g. from `brainFunnelCountsQuery`). No I/O. */
export function summariseFunnel(rows: BrainFunnelRow[], fetched?: number): BrainFunnelSummary {
  let analysed = 0;
  const stoppedBy: Record<string, number> = {};
  for (const row of rows) {
    if (REACHED_MODEL.has(row.decision)) {
      analysed += row.count;
    } else {
      stoppedBy[row.decision] = (stoppedBy[row.decision] ?? 0) + row.count;
    }
  }
  const modelCallShare = fetched !== undefined && fetched > 0 ? analysed / fetched : null;
  return {
    ...(fetched !== undefined ? { fetched } : {}),
    analysed,
    stoppedBy,
    modelCallShare,
  };
}

export type RecordBrainEventInput = {
  workspaceId: string;
  stage: BrainStage | "analysis";
  decision: string;
  subjectId?: string | null;
  detail?: Record<string, unknown> | null;
  promptVersion?: string | null;
};

/**
 * Fire-and-forget telemetry write. The DB query module is imported
 * dynamically so this module stays DB-free at the top level (it is unit
 * tested with no DATABASE_URL configured) — and so the catch below is the
 * only path, even if the import itself fails.
 */
export async function recordBrainEvent(input: RecordBrainEventInput): Promise<void> {
  try {
    const { insertBrainTelemetry } = await import("@/db/queries/platina-brain");
    await insertBrainTelemetry({
      workspaceId: input.workspaceId,
      stage: input.stage,
      decision: input.decision,
      subjectId: input.subjectId ?? null,
      detail: input.detail ?? null,
      promptVersion: input.promptVersion ?? null,
    });
  } catch (error) {
    console.warn("[platina] brain telemetry write skipped:", error instanceof Error ? error.message : error);
  }
}
