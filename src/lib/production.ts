import { productionStage } from "@/db/schema";

export type ProductionStage = (typeof productionStage.enumValues)[number];

/** Single source of truth for column order — derived from the pgEnum. */
export const PRODUCTION_STAGE_ORDER = productionStage.enumValues;

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  brief: "Brief",
  in_progress: "In progress",
  internal_review: "Internal review",
  revision: "Revision",
  done: "Done",
};

export type StageTransition = {
  to: ProductionStage;
  label: string;
  incrementsRevision: boolean;
};

/**
 * Not a straight line: internal_review has two exits (forward to done, or
 * back to revision — incrementing revisionCount); revision's only exit is
 * back to internal_review ("Resubmit"). done is a lane, not a sink — it
 * reopens to in_progress, because a mistaken "Mark done" must be
 * recoverable without a database admin.
 */
const TRANSITIONS: Record<ProductionStage, StageTransition[]> = {
  brief: [{ to: "in_progress", label: "Start", incrementsRevision: false }],
  in_progress: [
    {
      to: "internal_review",
      label: "Submit for review",
      incrementsRevision: false,
    },
  ],
  internal_review: [
    { to: "done", label: "Mark done", incrementsRevision: false },
    { to: "revision", label: "Send back", incrementsRevision: true },
  ],
  revision: [
    {
      to: "internal_review",
      label: "Resubmit",
      incrementsRevision: false,
    },
  ],
  done: [{ to: "in_progress", label: "Reopen", incrementsRevision: false }],
};

export function transitionsFor(stage: ProductionStage): StageTransition[] {
  return TRANSITIONS[stage];
}

export function isValidTransition(
  from: ProductionStage,
  to: ProductionStage,
): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}

export type NextStageOption = {
  stage: ProductionStage;
  allowed: boolean;
  /** Present whenever allowed is false — why this move isn't on the table. */
  reason?: string;
  /** Present whenever allowed is true — the semantic verb for this specific
   *  move ("Send back", "Resubmit"), sourced from TRANSITIONS via
   *  transitionsFor. A caller rendering a generic stage-name label (e.g. just
   *  "Revision") loses that distinction; this carries it along so the menu
   *  doesn't have to. */
  actionLabel?: string;
};

/**
 * Every stage, flagged for whether `current` can legally move to it right
 * now. Backs the Jira-style status menu: a workflow dropdown must not be a
 * free-form setter, so illegal destinations are never omitted — they're
 * returned disabled with a short reason. A greyed-out transition teaches the
 * workflow ("revision only resubmits to internal review"); a hidden one just
 * confuses. `allowed` is always derived from isValidTransition, so this can
 * never offer a move the transition graph rejects.
 */
export function nextStagesFrom(current: ProductionStage): NextStageOption[] {
  const transitions = transitionsFor(current);
  return PRODUCTION_STAGE_ORDER.map((stage) => {
    if (stage === current) {
      // Special-cased rather than routed through isValidTransition: no
      // stage's transition list ever names itself as a destination (there
      // are no self-transitions in TRANSITIONS), so
      // isValidTransition(current, current) is already false and would land
      // in the branch below anyway. This branch exists only to give the
      // current stage its own clearer reason ("this is the current stage")
      // instead of the generic "not reachable from X" every other rejected
      // destination gets — it changes the message, not the legality.
      return { stage, allowed: false, reason: "this is the current stage" };
    }
    if (isValidTransition(current, stage)) {
      return {
        stage,
        allowed: true,
        actionLabel: transitions.find((t) => t.to === stage)?.label,
      };
    }
    return {
      stage,
      allowed: false,
      reason: `not reachable from ${PRODUCTION_STAGE_LABELS[current].toLowerCase()}`,
    };
  });
}
