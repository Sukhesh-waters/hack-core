/**
 * Objection-rate telemetry (R5.1). A challenger instructed to attack will
 * always find something; if nearly every round ends contested or refuted,
 * "qualified" stops carrying information and the layer becomes cost without
 * signal. The rate is computed from recorded transcript states — no model
 * output is trusted to grade itself.
 */
import type { ResolveState } from "./contradiction";

export type ObjectionRound = { state: ResolveState };

export const OBJECTION_RATE_CEILING = 0.8;
export const OBJECTION_MIN_ROUNDS = 10;
export const OBJECTION_WINDOW = 20;

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
