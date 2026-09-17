/**
 * Grading write-back (Slice 9, R5.3). Pure decision module — the action
 * layer executes what this returns.
 *
 * A measured verdict becomes first-party (Plane A) evidence, so the next
 * retrieval cites what actually happened. A "did not work" verdict also
 * demotes the receipt's linked hypotheses: confidence floored, excluded from
 * retrieval by the existing active-status filter, retained with the receipt
 * link — a recorded failure is what stops the system re-proposing the same
 * direction in six months.
 */
import { chunkRecord } from "./chunking";

export type ReceiptForWriteback = {
  id: string;
  title: string;
  hypothesis: string;
  expectedOutcome: string;
  evidenceBrainIds: string[];
};

export type WritebackPlan = {
  /** Plane A evidence chunk content (record-boundary, R4.5). */
  evidenceContent: string;
  /** Brain chunk ids to demote (empty unless the verdict contradicts). */
  demoteBrainChunkIds: string[];
};

export function gradingWriteback(
  receipt: ReceiptForWriteback,
  outcome: "worked" | "did_not_work" | "inconclusive",
  outcomeNote: string | undefined,
): WritebackPlan {
  const evidenceContent = chunkRecord({
    label: `Measured outcome — ${receipt.title}`,
    fields: {
      hypothesis: receipt.hypothesis,
      expected: receipt.expectedOutcome,
      verdict: outcome.replace(/_/g, " "),
      note: outcomeNote ?? null,
    },
  });
  return {
    evidenceContent,
    demoteBrainChunkIds:
      outcome === "did_not_work" ? receipt.evidenceBrainIds : [],
  };
}

/** Demotion floors confidence — the hypothesis stays on record, visibly
 *  contradicted, and out of retrieval. */
export const DEMOTED_CONFIDENCE_FLOOR = 0.2;

export function demotedConfidence(current: number): number {
  return Math.min(current, DEMOTED_CONFIDENCE_FLOOR);
}
