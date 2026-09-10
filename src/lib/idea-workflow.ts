import { ideaStatus } from "@/db/schema";

export type IdeaStatus = (typeof ideaStatus.enumValues)[number];

/** Single source of truth for status order — derived from the pgEnum. */
export const IDEA_STATUS_ORDER = ideaStatus.enumValues;

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  new: "New",
  drafted: "Drafted",
  archived: "Archived",
};

/**
 * Static, fully-written Tailwind class strings (JIT scans source text, so
 * nothing here may be template-built). Shared by the Ideation and Plan &
 * Validate surfaces so the same status always reads the same colour.
 */
export const IDEA_STATUS_CHIP_CLASSES: Record<IdeaStatus, string> = {
  new: "bg-sky-400/15 text-sky-300",
  drafted: "bg-emerald-400/15 text-emerald-300",
  archived: "bg-destructive/15 text-destructive",
};

export type IdeaTransition = {
  to: IdeaStatus;
  label: string;
};

/**
 * A flat graph, not a line: "new" is the only decision point — it forks to
 * "drafted" (accept) or "archived" (reject). Both destinations are terminal;
 * neither surface lets you re-open a decided idea from this menu.
 */
const TRANSITIONS: Record<IdeaStatus, IdeaTransition[]> = {
  new: [
    { to: "drafted", label: "Accept" },
    { to: "archived", label: "Reject" },
  ],
  drafted: [{ to: "new", label: "Un-draft" }],
  archived: [{ to: "new", label: "Restore" }],
};

export function transitionsForIdea(status: IdeaStatus): IdeaTransition[] {
  return TRANSITIONS[status];
}

export function isValidIdeaTransition(
  from: IdeaStatus,
  to: IdeaStatus,
): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}

export type NextIdeaStatusOption = {
  status: IdeaStatus;
  allowed: boolean;
  /** Present whenever allowed is false — why this move isn't on the table. */
  reason?: string;
  /** Present whenever allowed is true — the semantic verb for this specific
   *  move ("Accept", "Reject"), sourced from TRANSITIONS. A caller rendering
   *  the generic destination status name (e.g. just "Drafted") loses that
   *  distinction; this carries it along so the menu doesn't have to. */
  actionLabel?: string;
};

/**
 * Every idea status, flagged for whether `current` can legally move to it
 * right now. Backs the Jira-style status menu on Ideation and Plan &
 * Validate: illegal destinations are never omitted, they're returned
 * disabled with a short reason — a greyed transition teaches the workflow
 * ("drafted is a terminal status"), a hidden one just confuses. `allowed` is
 * always derived from isValidIdeaTransition, so this can never offer a move
 * the transition graph rejects.
 */
export function nextIdeaStatusesFrom(
  current: IdeaStatus,
): NextIdeaStatusOption[] {
  const transitions = transitionsForIdea(current);
  return IDEA_STATUS_ORDER.map((status) => {
    if (status === current) {
      return { status, allowed: false, reason: "this is the current status" };
    }
    if (isValidIdeaTransition(current, status)) {
      return {
        status,
        allowed: true,
        actionLabel: transitions.find((t) => t.to === status)?.label,
      };
    }
    return {
      status,
      allowed: false,
      reason: `not reachable from ${IDEA_STATUS_LABELS[current].toLowerCase()}`,
    };
  });
}
