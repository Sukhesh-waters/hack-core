import { describe, expect, it } from "vitest";
import { creditOf } from "./credit";
import { planInsightReview } from "./insight-review";

describe("planInsightReview (B9 human gate on insights)", () => {
  it("approves an insight into active/agreed state and records an accepted ledger event", () => {
    const res = planInsightReview({
      chunkId: "c1",
      action: "approve",
      currentContent: "Bruker is expanding PFAS application notes in the Gulf.",
    });
    expect(res).toEqual({
      ok: true,
      action: "approve",
      brainState: { status: "active", agreementState: "agreed" },
      editedContent: null,
      ledgerEvent: {
        kind: "accepted",
        reason: null,
        detail: { ref: "brain:c1", action: "approve" },
      },
      cause: "insight-review:approve",
    });
  });

  it("edits an insight when replacement text is valid, and refuses empty text", () => {
    expect(
      planInsightReview({
        chunkId: "c1",
        action: "edit",
        currentContent: "Old claim.",
        editedContent: "   ",
      }),
    ).toEqual({
      ok: false,
      error: "Edited insight text must be at least 8 characters.",
    });

    const edited = planInsightReview({
      chunkId: "c1",
      action: "edit",
      currentContent: "Old claim.",
      editedContent: "Bruker opened a regional application lab in Dubai.",
    });
    expect(edited.ok && edited.editedContent).toBe(
      "Bruker opened a regional application lab in Dubai.",
    );
  });

  it("rejects with reason: demotes (never deletes) and 'wrong_fact' lowers input trust in credit.ts", () => {
    const rejected = planInsightReview({
      chunkId: "c1",
      action: "reject",
      currentContent: "Incorrect competitor claim.",
      rejectReason: "wrong_fact",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;

    expect(rejected.brainState).toEqual({ status: "demoted", confidence: 0.05 });
    expect(rejected.ledgerEvent.reason).toBe("wrong_fact");

    // Verify that feeding this ledger event into creditOf penalises brain:c1
    // at full weight (beta = 1, alpha = 0) and leaves features untouched.
    const credit = creditOf(
      {
        id: "sug-1",
        title: "Idea resting on c1",
        inputs: [
          { ref: "brain:c1", label: "Incorrect competitor claim", plane: "C", url: null, weight: 0.5 },
          { ref: "own:waters", label: "Waters Xevo page", plane: "A", url: null, weight: 0.5 },
        ],
        features: { topic: "pfas analysis", channel: "linkedin" },
      },
      {
        id: "ev-1",
        suggestionId: "sug-1",
        kind: rejected.ledgerEvent.kind,
        reason: rejected.ledgerEvent.reason,
        reward: null,
        detail: rejected.ledgerEvent.detail,
        createdAt: new Date("2026-10-15T00:00:00Z"),
      },
    );
    expect(credit?.inputs).toEqual([
      { ref: "brain:c1", label: "Incorrect competitor claim", plane: "C", alpha: 0, beta: 1 },
    ]);
    expect(credit?.features).toEqual([]);
  });

  it("refuses a reject without one of the four valid reasons", () => {
    expect(
      planInsightReview({
        chunkId: "c1",
        action: "reject",
        currentContent: "Some claim.",
        rejectReason: "",
      }),
    ).toEqual({
      ok: false,
      error: "Pick why this insight is rejected (Wrong fact, Not new, Not testable, or Other).",
    });
  });
});
