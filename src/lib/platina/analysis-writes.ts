/**
 * The pure decision of what `signal-analyze.ts` writes for one document,
 * given the plan `analysis-plan.ts` already produced and — once a debate
 * ran — its outcome. No I/O: every actual write (insertTranscript,
 * insertBrainChunk, insertFinding, markSignalSkipped, markSignalProcessed)
 * is still issued by the Inngest function; this module only decides WHAT
 * those calls should write, narrowly extracted so the decision is
 * unit-testable without a database and provably unchanged by the B0
 * legacy-equivalence golden test (plan §11.5).
 */
import type { BrainSkipCause } from "@/db/platina-schema";
import type { Attack, Claim, ResolveResult } from "./contradiction";
import { findingTitleFor } from "./finding-title";
import { findingPathFor, findingUseCaseForSourceKind } from "./findings";
import type { AnalysisPlan } from "./analysis-plan";

/** Said next to the `nothing_new` skip, unchanged from today's wording. */
export const NOTHING_NEW_SKIP_REASON =
  "Read, but there was no new move on this page.";

/** The fields of a debate outcome this decision needs (a subset of runContradictionRound's return). */
export type DebateOutcome = {
  claim: Claim;
  attack: Attack;
  result: ResolveResult;
  headline: string | null;
  nothingNew: boolean;
};

export type AnalysisWriteContext = {
  competitorName: string | null;
  pageTitle: string | null;
  sourceKind: string | undefined;
};

export type TranscriptWrite = {
  proposerClaim: string;
  challengerAttack: string;
  score: number;
  state: ResolveResult["state"];
  strongestObjection?: string;
};

export type BrainChunkWrite = {
  content: string;
  confidence: number;
  agreementState: ResolveResult["state"];
  generation: number;
};

export type FindingWrite = {
  title: string;
  summary: string;
  strongestObjection: string;
  status: "new" | "needs_decision";
  useCase: string;
};

export type AnalysisWrites = {
  /** Set when markSignalSkipped(reason, cause) is the call made. */
  skip?: { reason: string; cause: BrainSkipCause };
  /** True when markSignalProcessed is the (or an additional) call made. */
  processed: boolean;
  /** Set once a debate ran — insertTranscript's payload. */
  transcript?: TranscriptWrite;
  /** Set only when the debate state earns a Brain chunk. */
  brainChunk?: BrainChunkWrite;
  /** Set only when the debate state earns a finding. */
  finding?: FindingWrite;
};

/**
 * `debate` is required once `plan.action === "analyse"` — a plan that
 * survived to analysis always has a debate outcome by the time this is
 * called. Passed as a parameter (not read from `plan`) so plan and debate
 * stay the two independently-faked inputs the golden test drives.
 */
export function analysisWrites(
  plan: AnalysisPlan,
  debate: DebateOutcome | undefined,
  context: AnalysisWriteContext,
): AnalysisWrites {
  if (plan.action === "skip") {
    // Today's exact branch (signal-analyze.ts): a client's own page is
    // marked processed directly, never written as a skip row.
    if (plan.cause === "own_brand") return { processed: true };
    return { skip: { reason: plan.reason, cause: plan.cause }, processed: false };
  }

  if (!debate) {
    throw new Error(
      "analysisWrites: a debate outcome is required once a plan survives to analysis",
    );
  }

  const transcript: TranscriptWrite = {
    proposerClaim: debate.claim.text,
    challengerAttack: debate.attack.text,
    score: debate.result.score,
    state: debate.result.state,
    strongestObjection: debate.result.caveat,
  };

  // The proposer is allowed to say a page holds no move — but only when the
  // page itself did not change; a changed page whose proposer still says
  // "nothing new" falls through to the ordinary debate-state writes below.
  if (debate.nothingNew && !plan.changed) {
    return {
      transcript,
      skip: { reason: NOTHING_NEW_SKIP_REASON, cause: "nothing_new" },
      processed: false,
    };
  }

  const path = findingPathFor(debate.result.state);

  const brainChunk: BrainChunkWrite | undefined = path.brainChunk
    ? {
        content: debate.result.caveat
          ? `${debate.claim.text}\nCaveat: ${debate.result.caveat}`
          : debate.claim.text,
        confidence: debate.result.score,
        agreementState: debate.result.state,
        generation: 0,
      }
    : undefined;

  const finding: FindingWrite | undefined = path.finding
    ? {
        title: findingTitleFor({
          headline: debate.headline,
          competitorName: context.competitorName,
          claimText: debate.claim.text,
          pageTitle: context.pageTitle,
        }),
        summary: debate.claim.text,
        strongestObjection: debate.result.caveat ?? debate.attack.text,
        status: path.finding === "needs_decision" ? "needs_decision" : "new",
        useCase: findingUseCaseForSourceKind(context.sourceKind),
      }
    : undefined;

  return { transcript, brainChunk, finding, processed: true };
}
