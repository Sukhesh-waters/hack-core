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
export function resolve(claim: Claim, attack: Attack): ResolveResult {
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
  if (score < CONTESTED_FLOOR) {
    return { state: "contested", score };
  }
  if (score < QUALIFIED_FLOOR) {
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
