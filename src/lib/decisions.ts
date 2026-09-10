export const DECISION_OUTCOMES = [
  "pending",
  "worked",
  "did_not_work",
  "inconclusive",
] as const;

export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const DECISION_OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  pending: "Awaiting review",
  worked: "Worked",
  did_not_work: "Did not work",
  inconclusive: "Inconclusive",
};

/** Static, fully-written class strings — Tailwind's JIT scans source text. */
export const DECISION_OUTCOME_CHIP: Record<DecisionOutcome, string> = {
  pending: "border-border text-muted-foreground/70",
  worked: "border-emerald-400/40 text-emerald-300",
  did_not_work: "border-destructive/40 text-destructive",
  inconclusive: "border-brand-amber/40 text-brand-amber",
};

/**
 * The two-layer guard (I2) for the decisions table, mirroring validateCitations.
 * Evidence for a decision is FIRST-PARTY POST IDS ONLY. A pattern-layer id is
 * inspiration, never proof, and must never be storable as evidence for a claim
 * about what worked. Strips silently rather than throwing — same posture as
 * validateCitations: keep the human's reasoning, drop the unsupportable citation.
 */
export function validateDecisionEvidence(
  ids: string[],
  allowedFirstPartyIds: string[],
): string[] {
  const allowed = new Set(allowedFirstPartyIds);
  return ids.filter((id) => allowed.has(id));
}

export function isDueForReview(
  decision: { reviewAt: Date; outcome: DecisionOutcome },
  now: Date,
): boolean {
  return (
    decision.outcome === "pending" &&
    new Date(decision.reviewAt).getTime() <= now.getTime()
  );
}

/**
 * Terminal outcomes do not reopen. A decision's recorded result is the audit
 * trail the whole table exists for — letting it flip back to pending would make
 * "we can show which decisions worked" unfalsifiable.
 */
export function canTransitionOutcome(
  from: DecisionOutcome,
  to: DecisionOutcome,
): boolean {
  if (from !== "pending") return false;
  return to !== "pending";
}
