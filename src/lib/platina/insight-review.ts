/**
 * B9 human gate on Brain insights (plan §5 B9 / brief §3 stage 9):
 * approve / edit / reject-with-reason on an insight.
 *
 * Pure, DB-free. Every Brain state transition returned here is applied by
 * the caller exclusively through `setBrainState()` (plan §11.2). A reject is
 * also recorded as a ledger event against suggestions that cited this
 * insight (`brain:<chunkId>`), and a "wrong_fact" rejection lowers that
 * input's trust at full weight in `credit.ts` without touching idea features.
 */
import type { BrainState } from "./brain-state";

export const INSIGHT_REVIEW_ACTIONS = ["approve", "edit", "reject"] as const;
export type InsightReviewAction = (typeof INSIGHT_REVIEW_ACTIONS)[number];

export const INSIGHT_REJECT_REASONS = [
  "wrong_fact",
  "not_new",
  "not_testable",
  "other",
] as const;
export type InsightRejectReason = (typeof INSIGHT_REJECT_REASONS)[number];

export const INSIGHT_REJECT_REASON_LABEL: Record<InsightRejectReason, string> = {
  wrong_fact: "Wrong fact",
  not_new: "Not new",
  not_testable: "Not testable",
  other: "Other",
};

export function isInsightReviewAction(value: string): value is InsightReviewAction {
  return (INSIGHT_REVIEW_ACTIONS as readonly string[]).includes(value);
}

export function isInsightRejectReason(value: string): value is InsightRejectReason {
  return (INSIGHT_REJECT_REASONS as readonly string[]).includes(value);
}

export type PlannedInsightReview =
  | {
      ok: true;
      action: InsightReviewAction;
      brainState: BrainState;
      /** Non-null only for `edit` when a human revised the insight text. */
      editedContent: string | null;
      /** Ledger event to record on suggestions citing `brain:<chunkId>`. */
      ledgerEvent: {
        kind: "accepted" | "dismissed";
        reason: string | null;
        detail: Record<string, unknown>;
      };
      cause: string;
    }
  | {
      ok: false;
      error: string;
    };

export function planInsightReview(input: {
  chunkId: string;
  action: string;
  currentContent: string;
  editedContent?: string | null;
  rejectReason?: string | null;
  note?: string | null;
}): PlannedInsightReview {
  if (!isInsightReviewAction(input.action)) {
    return { ok: false, error: "Pick a valid insight review action (approve, edit, or reject)." };
  }

  const ref = `brain:${input.chunkId}`;
  const note = (input.note ?? "").trim() || null;

  if (input.action === "approve") {
    return {
      ok: true,
      action: "approve",
      brainState: { status: "active", agreementState: "agreed" },
      editedContent: null,
      ledgerEvent: {
        kind: "accepted",
        reason: null,
        detail: { ref, action: "approve", ...(note ? { note } : {}) },
      },
      cause: "insight-review:approve",
    };
  }

  if (input.action === "edit") {
    const edited = (input.editedContent ?? "").trim();
    if (edited.length < 8) {
      return { ok: false, error: "Edited insight text must be at least 8 characters." };
    }
    return {
      ok: true,
      action: "edit",
      brainState: { status: "active", agreementState: "agreed" },
      editedContent: edited,
      ledgerEvent: {
        kind: "accepted",
        reason: "edited",
        detail: { ref, action: "edit", previous: input.currentContent, ...(note ? { note } : {}) },
      },
      cause: "insight-review:edit",
    };
  }

  const reason = (input.rejectReason ?? "").trim();
  if (!isInsightRejectReason(reason)) {
    return {
      ok: false,
      error: "Pick why this insight is rejected (Wrong fact, Not new, Not testable, or Other).",
    };
  }

  return {
    ok: true,
    action: "reject",
    // Refuted/rejected insights are demoted, never deleted (invariant §10).
    brainState: { status: "demoted", confidence: 0.05 },
    editedContent: null,
    ledgerEvent: {
      kind: "dismissed",
      // "wrong_fact" maps directly to credit.ts's input-trust penalty; other
      // reasons record a dismissal with the specific reason in detail.
      reason: reason === "wrong_fact" ? "wrong_fact" : reason,
      detail: { ref, action: "reject", insightRejectReason: reason, ...(note ? { note } : {}) },
    },
    cause: `insight-review:reject:${reason}`,
  };
}
