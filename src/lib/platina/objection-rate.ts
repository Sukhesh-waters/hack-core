/**
 * Objection-rate telemetry (R5.1). A challenger instructed to attack will
 * always find something; if nearly every round ends contested or refuted,
 * "qualified" stops carrying information and the layer becomes cost without
 * signal. The rate is computed from recorded transcript states — no model
 * output is trusted to grade itself.
 */
import type { ResolveState } from "./contradiction";

export type ObjectionRound = { state: ResolveState };

/**
 * The brief's ceiling (plan §5 B2). Was 0.8 before B2; moved to 0.7 once the
 * challenger is actually blind, because a challenger that could see the
 * proposer's own confidence score could never climb much past "mostly
 * agrees with whatever sounded sure of itself" — 0.7 is only a meaningful
 * ceiling once agreement reflects the evidence rather than the proposer's
 * own tone.
 */
export const OBJECTION_RATE_CEILING = 0.7;
export const OBJECTION_MIN_ROUNDS = 10;
export const OBJECTION_WINDOW = 20;

/**
 * The brief's "blinding failed" alarm (plan §5 B2): proposer models whose
 * agreement rate differs by more than this many points, at N >= minPerModel
 * each, means the second opinion is not actually blind to which model
 * proposed — something is leaking.
 */
export const AGREEMENT_GAP_CEILING = 0.15;

/** Share of rounds the challenger materially contested or refuted. */
export function objectionRate(rounds: ObjectionRound[]): number {
  if (rounds.length === 0) return 0;
  const objected = rounds.filter(
    (r) => r.state === "contested" || r.state === "refuted",
  ).length;
  return objected / rounds.length;
}

/**
 * True only with enough rounds to mean something — a 2/2 start is not an
 * alarm. The ceiling breach targets the prompt version, not the claims.
 */
export function objectionCeilingExceeded(
  rounds: ObjectionRound[],
  ceiling = OBJECTION_RATE_CEILING,
  minRounds = OBJECTION_MIN_ROUNDS,
): boolean {
  if (rounds.length < minRounds) return false;
  return objectionRate(rounds) >= ceiling;
}

/**
 * One rate per key — per prompt version, per proposer model, or per blinded
 * arm (B2 plan §5), whichever `keyOf` groups by. `keyOf` returning `null`
 * excludes a round from every group (the "before tracking" rows elsewhere
 * in this codebase use the same convention: legacy data is never folded
 * into a rate as a phantom bucket). Sorted by key for a stable read order.
 */
export function objectionRateBy<T extends ObjectionRound>(
  rounds: T[],
  keyOf: (round: T) => string | null,
): { key: string; rate: number; n: number }[] {
  const byKey = new Map<string, T[]>();
  for (const round of rounds) {
    const key = keyOf(round);
    if (key === null) continue;
    const list = byKey.get(key);
    if (list) {
      list.push(round);
    } else {
      byKey.set(key, [round]);
    }
  }
  return Array.from(byKey.entries())
    .map(([key, list]) => ({ key, rate: objectionRate(list), n: list.length }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** One round of agreement-by-model input: the debate state and who proposed it. */
export type AgreementRound = { state: ResolveState; proposerModel: string | null };

export type AgreementGapAlarmOptions = {
  /** Neither model's rate counts toward a gap below this many rounds (plan §5 B2: N >= 20). */
  minPerModel: number;
  /** A gap larger than this many points (plan §5 B2: 0.15) raises the alarm. */
  maxGap: number;
};

export type AgreementGapAlarmResult = {
  /** True only when two models both cleared `minPerModel` and differ by more than `maxGap`. */
  alarmed: boolean;
  /** Every proposer model that cleared `minPerModel`, with its agreement ("agreed" state) rate. */
  rates: { model: string; rate: number; n: number }[];
  /** The widest-differing pair, only set when `alarmed`. */
  gap?: { models: [string, string]; difference: number };
};

/**
 * The B2 "blinding failed" alarm (plan §5 B2, §8 "Agreement by proposer
 * model"): if two proposer models' agreement rates diverge by more than
 * `maxGap` once both have enough rounds, the challenger is behaving
 * differently depending on which model proposed — which a genuinely blind
 * challenger cannot do, because it never sees which model that was.
 */
export function agreementGapAlarm(
  rounds: AgreementRound[],
  opts: AgreementGapAlarmOptions,
): AgreementGapAlarmResult {
  const byModel = new Map<string, AgreementRound[]>();
  for (const round of rounds) {
    if (round.proposerModel === null) continue;
    const list = byModel.get(round.proposerModel);
    if (list) {
      list.push(round);
    } else {
      byModel.set(round.proposerModel, [round]);
    }
  }
  const rates = Array.from(byModel.entries())
    .filter(([, list]) => list.length >= opts.minPerModel)
    .map(([model, list]) => ({
      model,
      rate: list.filter((r) => r.state === "agreed").length / list.length,
      n: list.length,
    }))
    .sort((a, b) => a.model.localeCompare(b.model));

  let gap: AgreementGapAlarmResult["gap"];
  for (let i = 0; i < rates.length; i++) {
    for (let j = i + 1; j < rates.length; j++) {
      const difference = Math.abs(rates[i].rate - rates[j].rate);
      if (difference > opts.maxGap && (!gap || difference > gap.difference)) {
        gap = { models: [rates[i].model, rates[j].model], difference };
      }
    }
  }
  return { alarmed: gap !== undefined, rates, ...(gap ? { gap } : {}) };
}
