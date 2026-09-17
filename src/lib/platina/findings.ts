/**
 * Finding lifecycle. Pure mapping between contradiction outcomes and finding
 * states, plus the review transition table. The query layer enforces the
 * guards in SQL; this module is the single definition both sides test
 * against.
 *
 * States: new → validated | dismissed; needs_decision → validated | refuted |
 * dismissed; validated → superseded. dismissed / refuted / superseded are
 * terminal in V1. Every transition requires a human note — the note is the
 * audit trail.
 */
import type { ResolveState } from "./contradiction";

export const FINDING_STATUSES = [
  "new",
  "needs_decision",
  "validated",
  "refuted",
  "dismissed",
  "superseded",
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * What a contradiction round produces. `agreed` becomes a visible finding and
 * a Brain chunk; `contested` becomes a finding awaiting a human and nothing
 * else; `refuted` leaves only the transcript; `qualified` survived with a
 * caveat and follows the agreed path (the caveat is the strongest objection).
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

export const FINDING_TRANSITIONS: Record<
  FindingStatus,
  readonly FindingStatus[]
> = {
  new: ["validated", "dismissed"],
  needs_decision: ["validated", "refuted", "dismissed"],
  validated: ["superseded"],
  refuted: [],
  dismissed: [],
  superseded: [],
};

export function canTransitionFinding(
  from: FindingStatus,
  to: FindingStatus,
): boolean {
  return FINDING_TRANSITIONS[from].includes(to);
}

export const FINDING_VERDICTS = [
  "validated",
  "refuted",
  "dismissed",
  "superseded",
] as const;

export type FindingVerdict = (typeof FINDING_VERDICTS)[number];

export function isFindingVerdict(value: string): value is FindingVerdict {
  return (FINDING_VERDICTS as readonly string[]).includes(value);
}

/** Business-language action labels per verdict (copy glossary). */
export const FINDING_VERDICT_LABEL: Record<FindingVerdict, string> = {
  validated: "Validate",
  refuted: "Rule out",
  dismissed: "Dismiss",
  superseded: "Supersede",
};
