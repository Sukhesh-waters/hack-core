/**
 * Claims and terminology screen. One violation shape:
 * { rule, excerpt, why } — the compliance-agent shape, not the live-meter fork.
 * Deterministic check overrides any model verdict.
 */

export type ClaimViolation = {
  rule: string;
  excerpt: string;
  why: string;
};

export type ClaimsDna = {
  bannedTerms: string[];
  regulatedClaims: string[];
};

export type ClaimsVerdict = {
  verdict: "passed" | "flagged";
  violations: ClaimViolation[];
  source: "deterministic" | "merged";
};

export function findBannedTerms(
  text: string,
  dna: ClaimsDna,
): ClaimViolation[] {
  const violations: ClaimViolation[] = [];
  const lower = text.toLowerCase();
  for (const term of dna.bannedTerms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    const idx = lower.indexOf(needle);
    if (idx >= 0) {
      violations.push({
        rule: "banned_term",
        excerpt: text.slice(Math.max(0, idx - 12), idx + term.length + 12),
        why: `"${term}" is banned terminology`,
      });
    }
  }
  for (const claim of dna.regulatedClaims) {
    const needle = claim.toLowerCase();
    if (!needle) continue;
    if (lower.includes(needle)) {
      violations.push({
        rule: "regulated_claim",
        excerpt: claim,
        why: `"${claim}" is a regulated claim and needs a human review`,
      });
    }
  }
  return violations;
}

export function enforceClaims(
  text: string,
  dna: ClaimsDna,
  modelViolations: ClaimViolation[] = [],
): ClaimsVerdict {
  const deterministic = findBannedTerms(text, dna);
  if (deterministic.length > 0) {
    return { verdict: "flagged", violations: deterministic, source: "deterministic" };
  }
  if (modelViolations.length > 0) {
    return { verdict: "flagged", violations: modelViolations, source: "merged" };
  }
  return { verdict: "passed", violations: [], source: "deterministic" };
}

export const MAX_REFINE_RETRIES = 1;
