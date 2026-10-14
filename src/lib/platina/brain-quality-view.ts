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
import {
  AGREEMENT_GAP_CEILING,
  OBJECTION_RATE_CEILING,
  agreementGapAlarm,
  objectionRate,
  objectionRateBy,
  OBJECTION_MIN_ROUNDS,
  type AgreementRound,
} from "./objection-rate";

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
  /**
   * B2 — whether this round's challenger saw the blind prompt. Optional:
   * every row from before B2 shipped has no such column value at all, which
   * reads the same as `null` (a round that predates the arm split) rather
   * than `false` (a round the "off"/today's-prompt arm positively chose).
   */
  blinded?: boolean | null;
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

/** The B2 alarm ceiling (plan §5 B2) — the same value objection-rate.ts's OBJECTION_RATE_CEILING now uses; kept as one named constant rather than two numbers that happen to match. */
export const OBJECTION_WATCH_CEILING = OBJECTION_RATE_CEILING;

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
 * B2 (plan §5 B2) — the shadow A/B: objection rate for the arm that saw the
 * blind prompt vs. the arm that saw today's. A gap here is the point of the
 * experiment, not a problem; "not enough data yet" below OBJECTION_MIN_ROUNDS
 * in EITHER arm, because comparing one well-measured arm against a thin one
 * would not mean anything.
 */
function blindVsNotRow(transcripts: BrainQualityTranscriptRow[]): BrainQualityRow {
  const label = "Second opinion, blind vs. not";
  const tagged = transcripts.filter(
    (t): t is BrainQualityTranscriptRow & { blinded: boolean } => typeof t.blinded === "boolean",
  );
  const byArm = objectionRateBy(tagged, (t) => (t.blinded ? "blind" : "not blind"));
  const blind = byArm.find((r) => r.key === "blind");
  const notBlind = byArm.find((r) => r.key === "not blind");
  if (!blind || !notBlind || blind.n < OBJECTION_MIN_ROUNDS || notBlind.n < OBJECTION_MIN_ROUNDS) {
    return { label, value: null, detail: "Not enough data yet.", status: "not_enough" };
  }
  const pct = (rate: number) => Math.round(rate * 100);
  return {
    label,
    value: null,
    detail:
      `Without the first answer's confidence or source: ${pct(blind.rate)}% objected (${blind.n} rounds). ` +
      `With it: ${pct(notBlind.rate)}% objected (${notBlind.n} rounds).`,
    status: "ok",
  };
}

/**
 * B2 (plan §5 B2) — the second "blinding failed" alarm: if two proposer
 * models' agreement rates diverge by more than AGREEMENT_GAP_CEILING once
 * both have enough rounds, the second opinion is behaving differently
 * depending on which model proposed — which it should never be able to see.
 */
function agreementGapRow(transcripts: BrainQualityTranscriptRow[]): BrainQualityRow {
  const label = "Second opinion may not be blind";
  const rounds: AgreementRound[] = transcripts.map((t) => ({ state: t.state, proposerModel: t.proposerModel }));
  const alarm = agreementGapAlarm(rounds, { minPerModel: AGREEMENT_MIN_ROUNDS, maxGap: AGREEMENT_GAP_CEILING });
  if (alarm.rates.length < 2) {
    return { label, value: null, detail: "Not enough data yet.", status: "not_enough" };
  }
  if (alarm.alarmed && alarm.gap) {
    const points = Math.round(alarm.gap.difference * 100);
    return {
      label,
      value: alarm.gap.difference,
      detail: `"${alarm.gap.models[0]}" and "${alarm.gap.models[1]}" agree with the proposer ${points} points apart — more than expected if the second opinion truly cannot see which model proposed.`,
      status: "watch",
    };
  }
  return { label, value: 0, detail: "Agreement rates are close across models — no sign of leakage.", status: "ok" };
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
    blindVsNotRow(input.transcripts),
    ...agreementRows(input.transcripts),
    agreementGapRow(input.transcripts),
    ...(legacy ? [legacy] : []),
    ...stageRows(input.modes),
  ];
}
