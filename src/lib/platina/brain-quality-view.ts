/**
 * Pure view model for Admin -> Health's "Brain quality" card (B0 —
 * metacognitive Brain; plan §5 B0, §8 metrics, §9 operator copy). Takes
 * already-fetched counts and rows; does no I/O, so it is unit tested with no
 * DATABASE_URL configured.
 *
 * Internal terms (falsifier, surprise filter, shadow mode, ...) are never
 * shown — see the banned-word scan in brain-quality-view.test.ts.
 */
import { BRAIN_STAGES, type BrainMode, type BrainStage } from "./brain-modes";
import { summariseFunnel, type BrainFunnelRow } from "./brain-telemetry";
import type { ResolveState } from "./contradiction";
import { objectionRate, OBJECTION_MIN_ROUNDS } from "./objection-rate";

export type BrainQualityStatus = "ok" | "watch" | "not_enough";

export type BrainQualityRow = {
  label: string;
  value: number | string | null;
  detail: string;
  status: BrainQualityStatus;
};

export type BrainQualityTranscriptRow = {
  promptVersion: string | null;
  proposerModel: string | null;
  objected: boolean | null;
  state: ResolveState;
};

export type BrainQualityInput = {
  /** Stage/decision counts for the window (brainFunnelCountsQuery, last 7 days). */
  funnel: BrainFunnelRow[];
  /** Documents fetched in the same window ("not enough data yet" when 0). */
  fetchedCount: number;
  /** Debate transcripts for the last 30 days. */
  transcripts: BrainQualityTranscriptRow[];
  /** Per-stage mode (getBrainModes()). */
  modes: Record<BrainStage, BrainMode>;
};

/** The B2 alarm ceiling (plan §5 B2): today's objection-rate.ts ceiling is 0.8; B2 moves it to 0.7. */
export const OBJECTION_WATCH_CEILING = 0.7;

/** The plan's N >= 20 floor for agreement-by-proposer-model (plan §5 B2, §8). */
export const AGREEMENT_MIN_ROUNDS = 20;

/** Plain words for each machine-readable stop reason (plan §9). */
const STOP_REASON_LABEL: Record<string, string> = {
  low_value: "Low-value page",
  nothing_new: "Read, nothing new",
  own_brand: "Client's own page",
  untestable: "The claim could not be tested",
  gate: "Didn't pass the quality check",
  surprise: "Nothing unusual compared with this page's normal changes",
};

function stopReasonLabel(decision: string): string {
  return STOP_REASON_LABEL[decision] ?? decision;
}

/** Plain-word stage names — never the internal stage id ("surprise" is banned vocabulary). */
const STAGE_LABEL: Record<BrainStage, string> = {
  interrogation: "Deeper reading of each claim",
  challenger: "Second opinion",
  gate: "Quality check",
  surprise: "Change filter",
  retrieval: "Evidence retrieval",
  budget: "Evidence budget",
  grading: "Results grading",
};

const MODE_LABEL: Record<BrainMode, string> = {
  off: "Off",
  shadow: "Watching only",
  on: "On",
};

const MODE_DETAIL: Record<BrainMode, string> = {
  off: "Not running.",
  shadow: "Computing in the background; nothing shown or changed yet.",
  on: "Live.",
};

/** "Documents read by a model": analysed / fetched, plus stopped counts in plain words. */
function documentsReadRow(funnel: BrainFunnelRow[], fetchedCount: number): BrainQualityRow {
  const summary = summariseFunnel(funnel, fetchedCount);
  const stoppedParts = Object.entries(summary.stoppedBy)
    .sort((a, b) => b[1] - a[1])
    .map(([decision, count]) => `${stopReasonLabel(decision)}: ${count}`);
  const detail =
    fetchedCount > 0
      ? `${summary.analysed} of ${fetchedCount} fetched documents reached a model.${
          stoppedParts.length > 0 ? ` Stopped — ${stoppedParts.join("; ")}.` : ""
        }`
      : "Not enough data yet.";
  return {
    label: "Documents read by a model",
    value: summary.modelCallShare,
    detail,
    status: summary.modelCallShare === null ? "not_enough" : "ok",
  };
}

/** One row per prompt version with at least one round; null versions are "before tracking" (see legacyRow). */
function objectionRows(transcripts: BrainQualityTranscriptRow[]): BrainQualityRow[] {
  const byVersion = new Map<string, ResolveState[]>();
  for (const t of transcripts) {
    if (t.promptVersion === null) continue;
    const list = byVersion.get(t.promptVersion) ?? [];
    list.push(t.state);
    byVersion.set(t.promptVersion, list);
  }
  const rows: BrainQualityRow[] = [];
  for (const [version, states] of byVersion) {
    const n = states.length;
    const label = `Second opinion objected — ${version}`;
    if (n < OBJECTION_MIN_ROUNDS) {
      rows.push({ label, value: null, detail: "Not enough data yet.", status: "not_enough" });
      continue;
    }
    const rate = objectionRate(states.map((state) => ({ state })));
    rows.push({
      label,
      value: rate,
      detail: `${n} rounds checked.`,
      status: rate > OBJECTION_WATCH_CEILING ? "watch" : "ok",
    });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** One row per proposer model with at least one round; null models are "before tracking" (see legacyRow). */
function agreementRows(transcripts: BrainQualityTranscriptRow[]): BrainQualityRow[] {
  const byModel = new Map<string, ResolveState[]>();
  for (const t of transcripts) {
    if (t.proposerModel === null) continue;
    const list = byModel.get(t.proposerModel) ?? [];
    list.push(t.state);
    byModel.set(t.proposerModel, list);
  }
  const rows: BrainQualityRow[] = [];
  for (const [model, states] of byModel) {
    const n = states.length;
    const label = `Agreement rate — ${model}`;
    if (n < AGREEMENT_MIN_ROUNDS) {
      rows.push({ label, value: null, detail: "Not enough data yet.", status: "not_enough" });
      continue;
    }
    const agreed = states.filter((s) => s === "agreed").length;
    rows.push({ label, value: agreed / n, detail: `${n} rounds checked.`, status: "ok" });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * How many transcripts predate prompt/model tracking. Grouped together and
 * shown once, informationally — never folded into a per-version or
 * per-model rate as a phantom 0.
 */
function legacyRow(transcripts: BrainQualityTranscriptRow[]): BrainQualityRow | null {
  const legacy = transcripts.filter((t) => t.promptVersion === null || t.proposerModel === null).length;
  if (legacy === 0) return null;
  return {
    label: "Before tracking (legacy)",
    value: null,
    detail: `${legacy} second-opinion round(s) recorded before prompt/model tracking — not counted in the rates above.`,
    status: "not_enough",
  };
}

/** Each stage's mode in plain words. */
function stageRows(modes: Record<BrainStage, BrainMode>): BrainQualityRow[] {
  return BRAIN_STAGES.map((stage) => {
    const mode = modes[stage] ?? "off";
    return {
      label: STAGE_LABEL[stage],
      value: MODE_LABEL[mode],
      detail: MODE_DETAIL[mode],
      status: "ok" as const,
    };
  });
}

/** Builds every row for the "Brain quality" card. Pure; no I/O. */
export function buildBrainQualityCard(input: BrainQualityInput): BrainQualityRow[] {
  const legacy = legacyRow(input.transcripts);
  return [
    documentsReadRow(input.funnel, input.fetchedCount),
    ...objectionRows(input.transcripts),
    ...agreementRows(input.transcripts),
    ...(legacy ? [legacy] : []),
    ...stageRows(input.modes),
  ];
}
