/**
 * The pure decision of what `signal-analyze.ts` writes for one document,
 * given the plan `analysis-plan.ts` already produced and — once a debate
 * ran — its outcome. No I/O: every actual write (insertTranscript,
 * insertBrainChunk, insertFinding, markSignalSkipped, markSignalProcessed)
 * is still issued by the Inngest function; this module only decides WHAT
 * those calls should write, narrowly extracted so the decision is
 * unit-testable without a database and provably unchanged by the B0
 * legacy-equivalence golden test (plan §11.5).
 *
 * B1 (metacognitive Brain): extended, not replaced, for the interrogation v2
 * path. The 4th parameter, `v2`, is undefined on every call the golden test
 * makes (mode "off") — every `brainChunk` field below is added only inside
 * `...(v2 ? {...} : {})`, so the function's output is byte-identical to
 * before when `v2` is omitted, which is what makes "off: today's path,
 * unchanged" provable rather than asserted.
 */
import type { BrainSkipCause } from "@/db/platina-schema";
import type { BrainMode } from "./brain-modes";
import type { Attack, Claim, ResolveResult } from "./contradiction";
import type { GateResult } from "./insight-gate";
import { chunkDirectionFor, type ValidateInterrogationResult, type Interrogation } from "./interrogation";
import { subjectKeyFor, type FalsifierClaim } from "./falsifier-metrics";
import { findingTitleFor } from "./finding-title";
import { findingPathFor, findingUseCaseForSourceKind } from "./findings";
import type { AnalysisPlan } from "./analysis-plan";

const DAY_MS = 86_400_000;

/** Said for the mode="on" skip when the interrogation failed validation (plan §5 B1). */
export const UNTESTABLE_SKIP_CAUSE: BrainSkipCause = "untestable";

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
  // B1 — present only when `v2` was passed to analysisWrites (shadow/on).
  kind?: "claim" | "fact";
  mechanism?: string;
  evidenceRefs?: string[];
  falsifier?: FalsifierClaim | null;
  subjectKey?: string | null;
  direction?: "up" | "down" | "none";
  gradeState?: "untested" | "insufficient";
  dueAt?: Date | null;
  promptVersion?: string;
  writtenBy?: string;
};

/**
 * B1's extra input to `analysisWrites`, present only in mode shadow/on
 * (plan §5 B1). `parsed` is the best-effort parse even when invalid —
 * shadow still writes a chunk off it (grade_state "insufficient"); on-mode
 * never reaches the chunk-building step when invalid (it skips first), so
 * `parsed` only matters there for the skip reason, which `interrogation`
 * already carries.
 */
export type AnalysisWritesV2Input = {
  mode: "shadow" | "on";
  interrogation: ValidateInterrogationResult;
  parsed: Interrogation | null;
  /** This signal document's id, for evidence_refs ("sig:<docId>#eN"). */
  signalDocumentId: string;
  now: Date;
  promptVersion: string;
  writtenBy: string;
  /**
   * B3 — the gate's OWN mode and already-computed verdict (the job computes
   * `testability`/`significance` through DB-backed readers before calling
   * `gateInsight`; this decision layer stays DB-free). "off" or omitted: no
   * effect, today's v2 behaviour. "shadow": no effect either — the write
   * proceeds exactly as today; the job logs the verdict for telemetry on
   * its own, independent of what gets written. "on": a refusal (`!result.pass`)
   * pre-empts the ordinary debate-state branch below with the "held" finding
   * and no Brain chunk (plan §5 B3: "deterministic beats model").
   */
  gate?: { mode: BrainMode; result: GateResult };
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
  v2?: AnalysisWritesV2Input,
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

  // B1, mode "on": an interrogation that failed validation never reaches the
  // Brain or a finding — it is skipped, cause "untestable", with the
  // transcript kept for audit (plan §5 B1). This overrides every other
  // branch below, including a state that would otherwise earn a chunk.
  if (v2 && v2.mode === "on" && !v2.interrogation.ok) {
    return {
      transcript,
      skip: { reason: v2.interrogation.reason, cause: UNTESTABLE_SKIP_CAUSE },
      processed: false,
    };
  }

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

  // B3, mode "on": a gate refusal pre-empts the ordinary debate-state branch
  // below — "deterministic beats model" (plan §5 B3). The claim is NOT
  // skipped (markSignalSkipped is never used here): the operator still sees
  // it as a finding, with the hold reason in the summary, but it never
  // becomes a retrievable Brain chunk. No agreement state, however strong
  // (including "agreed"), reaches this branch and overrides it — the gate's
  // own `result.pass` is the only thing consulted.
  if (v2?.gate && v2.gate.mode === "on" && !v2.gate.result.pass) {
    return {
      transcript,
      finding: {
        title: findingTitleFor({
          headline: debate.headline,
          competitorName: context.competitorName,
          claimText: debate.claim.text,
          pageTitle: context.pageTitle,
        }),
        summary: `Held: ${v2.gate.result.reasons.join("; ")}`,
        strongestObjection: debate.result.caveat ?? debate.attack.text,
        status: "new",
        useCase: findingUseCaseForSourceKind(context.sourceKind),
      },
      processed: true,
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
        ...(v2 ? brainChunkV2Fields(v2) : {}),
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

/**
 * B1's extra Brain-chunk fields (plan §4, 0088). `kind`/`how`/`why` come
 * from the validated interrogation when it passed, or from the best-effort
 * parse when it did not (shadow only reaches here when invalid — "on"
 * already returned above) — grade_state "insufficient" is what marks that
 * row as resting on an unvalidated reply (plan §5 B1).
 */
function brainChunkV2Fields(v2: AnalysisWritesV2Input): Required<
  Pick<
    BrainChunkWrite,
    "kind" | "mechanism" | "evidenceRefs" | "falsifier" | "subjectKey" | "direction" | "gradeState" | "dueAt" | "promptVersion" | "writtenBy"
  >
> {
  const source = v2.interrogation.ok ? v2.interrogation.value : v2.parsed;
  const kind: "claim" | "fact" = source?.kind === "fact" ? "fact" : "claim";
  const why = source?.why ?? [];
  // kind="fact" never carries a falsifier, even if a reply attached one
  // (plan D1): a fact is exempt from the falsifier, not merely missing one.
  // grade_state stays "untested" either way (facts are never graded) — a
  // fact row must never be promoted later; B5's grader is what enforces
  // that (it only grades rows that have a falsifier to test).
  const falsifier = kind === "claim" ? (source?.falsifier ?? null) : null;

  return {
    kind,
    mechanism: source?.how ?? "",
    evidenceRefs: why.map((id) => `sig:${v2.signalDocumentId}#${id}`),
    falsifier,
    subjectKey: falsifier ? subjectKeyFor(falsifier.subject) : null,
    direction: chunkDirectionFor(falsifier),
    gradeState: v2.interrogation.ok ? "untested" : "insufficient",
    dueAt: falsifier ? new Date(v2.now.getTime() + falsifier.window_days * DAY_MS) : null,
    promptVersion: v2.promptVersion,
    writtenBy: v2.writtenBy,
  };
}
