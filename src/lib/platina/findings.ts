/**
 * Finding lifecycle (Slice 3.5). Pure mapping between contradiction outcomes
 * and finding states, plus the ruling guard. The query layer enforces the
 * guard in SQL; this module is the single definition both sides test
 * against.
 *
 * Slice 3.5 scope: agreed and contested only. Qualified, dismissed, and
 * superseded land in Slice 4.
 */
import type { ResolveState } from "./contradiction";

export const FINDING_STATUSES = [
  "new",
  "needs_decision",
  "validated",
  "refuted",
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * What a contradiction round produces. `agreed` becomes a visible finding and
 * a Brain chunk; `contested` becomes a finding awaiting a human and nothing
 * else; `refuted` leaves only the transcript; `qualified` is deferred to
 * Slice 4 and currently follows the agreed path (it survived contradiction).
 */
export function findingPathFor(state: ResolveState): {
  finding: FindingStatus | null;
  brainChunk: boolean;
} {
  switch (state) {
    case "agreed":
    case "qualified":
      return { finding: "new", brainChunk: true };
    case "contested":
      return { finding: "needs_decision", brainChunk: false };
    case "refuted":
      return { finding: null, brainChunk: false };
  }
}

/** A ruling is only possible on a finding awaiting a decision, and is
 *  final in 3.5 — no re-ruling. Supersede arrives in Slice 4. */
export function canRule(
  status: FindingStatus,
): status is "needs_decision" {
  return status === "needs_decision";
}

export type RulingVerdict = "validated" | "refuted";

export function isRulingVerdict(value: string): value is RulingVerdict {
  return value === "validated" || value === "refuted";
}
