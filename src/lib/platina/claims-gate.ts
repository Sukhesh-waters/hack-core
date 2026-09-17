/**
 * Claims gate for final approval (Slice 6). Deterministic first, always:
 * `enforceClaims` runs over the solution's content plan and task titles, and
 * a deterministic failure blocks approval unless a named approver has
 * recorded an exception (a gate event with subjectType "claims_exception"
 * for the campaign). No model opinion overrides a deterministic failure.
 */
import { enforceClaims, type ClaimViolation, type ClaimsDna } from "./claims";

export const DEFAULT_CLAIMS_DNA: ClaimsDna = {
  bannedTerms: ["cure", "guaranteed", "best in class"],
  regulatedClaims: ["clinically proven", "FDA approved"],
};

export type ClaimsGateResult = {
  verdict: "passed" | "flagged";
  violations: ClaimViolation[];
  /** True when violations exist and no exception is recorded. */
  blocksApproval: boolean;
  excepted: boolean;
};

export function claimsGate(input: {
  contentPlan: string | null;
  taskTitles: string[];
  hasException: boolean;
  dna?: ClaimsDna;
}): ClaimsGateResult {
  const dna = input.dna ?? DEFAULT_CLAIMS_DNA;
  const texts = [input.contentPlan ?? "", ...input.taskTitles].filter(
    (t) => t.trim() !== "",
  );
  const violations = texts.flatMap(
    (text) => enforceClaims(text, dna).violations,
  );
  const flagged = violations.length > 0;
  return {
    verdict: flagged ? "flagged" : "passed",
    violations,
    blocksApproval: flagged && !input.hasException,
    excepted: flagged && input.hasException,
  };
}
