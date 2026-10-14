export const CONTESTED_FLOOR = 0.4;
export const QUALIFIED_FLOOR = 0.7;

export type Claim = {
  text: string;
  evidenceSpans: string[];
  specificity: number;
};

export type Attack = {
  text: string;
  confounders: string[];
  strongestObjection: string;
  confounderStrength: number;
};

export type ResolveState = "agreed" | "qualified" | "contested" | "refuted";

export type ResolveResult = {
  state: ResolveState;
  score: number;
  caveat?: string;
};

/**
 * Deterministic contradiction scoring. One round only — no code path
 * requests a second. Not a model decision.
 */
export function resolve(
  claim: Claim,
  attack: Attack,
  floors?: { contestedFloor?: number; qualifiedFloor?: number },
): ResolveResult {
  // Stored workspace thresholds win; the constants are the documented
  // defaults when no config exists (Slice 10 — runtime paths consume config).
  const contestedFloor = floors?.contestedFloor ?? CONTESTED_FLOOR;
  const qualifiedFloor = floors?.qualifiedFloor ?? QUALIFIED_FLOOR;
  const overlap =
    claim.evidenceSpans.length === 0
      ? 0
      : claim.evidenceSpans.filter((span) =>
          attack.text.toLowerCase().includes(span.toLowerCase().slice(0, 24)),
        ).length / claim.evidenceSpans.length;

  const specificity = Math.min(1, Math.max(0, claim.specificity));
  const confounder = Math.min(1, Math.max(0, attack.confounderStrength));

  const score = Math.max(
    0,
    Math.min(1, 0.45 * specificity + 0.35 * (1 - confounder) + 0.2 * (1 - overlap * 0.5)),
  );

  if (confounder >= 0.9 && specificity < 0.3) {
    return { state: "refuted", score };
  }
  if (score < contestedFloor) {
    return { state: "contested", score };
  }
  if (score < qualifiedFloor) {
    return {
      state: "qualified",
      score,
      caveat: attack.strongestObjection,
    };
  }
  return { state: "agreed", score };
}

export const ONE_ROUND = 1;

export function nextRoundAllowed(): false {
  return false;
}

// ---------------------------------------------------------------------------
// resolveV2 (B3, owner decision D7) — drops the proposer's self-reported
// specificity/confidence from the score entirely. `resolve()` above is kept
// byte-identical for v1 and for mode="off"/"shadow" (shadow computes this
// beside it, never instead of it — debate.ts decides which one a round uses).
// ---------------------------------------------------------------------------

export type ResolveV2Input = {
  /** Validated cited-span coverage: interrogation.ts's validated `why` ids over the spans the input offered. 0 when nothing validated (an invalid reply, or no spans cited). */
  evidenceCoverage: number;
  /** The challenger's own confounder strength (0-1) — the same deterministic input resolve() already uses. */
  confounderStrength: number;
  /**
   * Whether the claim's OWN falsifier passes the registry's structural check
   * (falsifier-metrics.ts validateFalsifier) — never the proposer's opinion
   * of itself. A fact is falsifier-exempt (D1) and always counts as valid
   * here; a claim with no falsifier, or one the registry rejects, is not.
   */
  falsifierValid: boolean;
  /** Carried through unchanged for the "qualified" caveat, same as resolve()'s `attack.strongestObjection`. */
  strongestObjection: string;
};

/**
 * Deterministic contradiction scoring, v2 (plan §5 B3, D7). Same shape as
 * `resolve()` — one round, same floors, same refute/contest/qualify/agree
 * ladder — but NONE of its three weighted inputs is anything the proposer
 * reported about itself: evidence coverage is checked against the input's
 * own span map, confounder strength is the challenger's judgement, and
 * falsifier validity is a registry lookup. A claim's stated `confidence` has
 * no parameter here to feed even by accident, which is what makes resolveV2
 * invariant to it by construction, not by convention.
 */
export function resolveV2(
  input: ResolveV2Input,
  floors?: { contestedFloor?: number; qualifiedFloor?: number },
): ResolveResult {
  const contestedFloor = floors?.contestedFloor ?? CONTESTED_FLOOR;
  const qualifiedFloor = floors?.qualifiedFloor ?? QUALIFIED_FLOOR;

  const coverage = Math.min(1, Math.max(0, input.evidenceCoverage));
  const confounder = Math.min(1, Math.max(0, input.confounderStrength));
  const falsifierTerm = input.falsifierValid ? 1 : 0;

  // Same weighting shape as resolve(): 0.45 for the claim's own strength,
  // 0.35 for the challenger's confounder, 0.2 for the remaining structural
  // check — summing to 1.0 at the best case, as resolve() does.
  const score = Math.max(
    0,
    Math.min(1, 0.45 * coverage + 0.35 * (1 - confounder) + 0.2 * falsifierTerm),
  );

  if (confounder >= 0.9 && coverage < 0.3) {
    return { state: "refuted", score };
  }
  if (score < contestedFloor) {
    return { state: "contested", score };
  }
  if (score < qualifiedFloor) {
    return { state: "qualified", score, caveat: input.strongestObjection };
  }
  return { state: "agreed", score };
}
