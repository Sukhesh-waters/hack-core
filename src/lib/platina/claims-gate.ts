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

/**
 * Workspace rules win when they exist; an empty active set falls back to the
 * documented defaults (the UI says so plainly). Archived rules are filtered
 * before this is called.
 */
export function claimsDnaFromRules(
  rules: { kind: "banned_term" | "regulated_claim"; term: string }[],
): { dna: ClaimsDna; source: "workspace" | "default" } {
  if (rules.length === 0) {
    return { dna: DEFAULT_CLAIMS_DNA, source: "default" };
  }
  return {
    dna: {
      bannedTerms: rules
        .filter((r) => r.kind === "banned_term")
        .map((r) => r.term),
      regulatedClaims: rules
        .filter((r) => r.kind === "regulated_claim")
        .map((r) => r.term),
    },
    source: "workspace",
  };
}

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

export type ScoredRecommendation = {
  id: string;
  title: string;
  text: string;
  score: number;
  evidence: string[];
};

export type RuleConflictEscalation = {
  id: string;
  title: string;
  /** Deterministic rule always wins (plan §5 B9 / brief §2 Heinz). */
  ruleWins: true;
  blocked: true;
  ruleSide: {
    violations: ClaimViolation[];
    summary: string;
  };
  evidenceSide: {
    score: number;
    rank: number;
    total: number;
    evidence: string[];
  };
};

/**
 * B9 Heinz rule-conflict check (narrow, no moral-reasoning layer): when a
 * recommendation scores in the top third of its cohort and `claimsGate`
 * blocks it, the deterministic rule wins and an escalation item shows both
 * sides (the rule vs the evidence and score).
 */
export function detectRuleConflicts(
  candidates: ScoredRecommendation[],
  dna: ClaimsDna = DEFAULT_CLAIMS_DNA,
): RuleConflictEscalation[] {
  if (candidates.length === 0) return [];
  const ordered = [...candidates].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
  const topThirdCount = Math.max(1, Math.ceil(ordered.length / 3));
  const topThird = ordered.slice(0, topThirdCount);

  const escalations: RuleConflictEscalation[] = [];
  topThird.forEach((item, index) => {
    const gate = claimsGate({
      contentPlan: item.text,
      taskTitles: [item.title],
      hasException: false,
      dna,
    });
    if (!gate.blocksApproval) return;
    escalations.push({
      id: item.id,
      title: item.title,
      ruleWins: true,
      blocked: true,
      ruleSide: {
        violations: gate.violations,
        summary: gate.violations.map((v) => v.why).join("; "),
      },
      evidenceSide: {
        score: item.score,
        rank: index + 1,
        total: ordered.length,
        evidence: item.evidence,
      },
    });
  });

  return escalations;
}
