/**
 * B2 — the blind challenger (Metacognitive Brain plan §5 B2). Pure, DB-free:
 * builds the challenger's prompt for the one case debate.ts's
 * `runInterrogationRound` needs it — a workspace whose "challenger" mode is
 * "shadow" (half the time, by `deterministicShare`) or "on" (always).
 *
 * Today's challenger (debate.ts CHALLENGER_SYSTEM + its `Signal:\n...\n\nClaim:\n...`
 * prompt) hands the challenger the raw signal text (so the source URL/domain
 * is visible) and the proposer's raw JSON reply verbatim — which includes
 * `specificity`/`confidence`, `noveltyReason`, and whatever else the proposer
 * schema happens to carry. None of that is a judgement about the claim
 * itself, so a challenger that can see it is not an independent check — it
 * can simply defer to a proposer that already sounded sure of itself.
 *
 * `blindChallengerInput` strips all of that back to exactly three things:
 * the claim (`what`), the mechanism (`how`), and the TEXTS of the spans the
 * proposer actually cited (`why`, resolved through the same span map
 * analysis-input.ts built). No provider id, no model id, no confidence or
 * specificity, no source URL or domain, no raw proposer JSON, no prior
 * score. Competitor names stay — they live inside the claim and span texts,
 * which are not provenance, they are the evidence itself.
 */
import type { Interrogation } from "./interrogation";
import type { SpanMap } from "./analysis-input";

/** The three fields `blindChallengerInput` is allowed to read from a parsed reply. */
export type BlindChallengerBasis = Pick<Interrogation, "what" | "how" | "why">;

/**
 * Same three judgements as today's CHALLENGER_SYSTEM (new? supported?
 * confounders?), plus an explicit verdict field. "No material objection" is
 * named here as a correct, expected answer — not a failure to find
 * something — so a challenger given a genuinely clean claim does not invent
 * an objection just to have one.
 */
export const BLIND_CHALLENGER_SYSTEM = [
  "You attack a claim made about a competitor. You are given only the claim, its mechanism and the exact text of the evidence it cites — not who proposed it, what source it came from, or how sure they said they were.",
  "Judge three things: (1) is this actually NEW, or is it ordinary marketing copy any competitor in this market would publish? (2) does the cited evidence really support it, or was it inferred? (3) what else could explain it — confounders.",
  "A claim that would be true of almost any company in this market is a weak claim: say so, and give it a high confounder strength.",
  'A genuinely clean claim with no real defect earns verdict "no_material_objection" — that is a correct, expected answer, not a failure to find something.',
  'Reply JSON only: {"text":string, "confounders":string[], "strongestObjection":string (or "none"), "confounderStrength":number 0-1, "verdict":"no_material_objection"|"objection"}.',
].join(" ");

/**
 * The challenger's entire prompt in blind mode: `what`, `how`, and the
 * TEXTS of the spans `why` cites — nothing else. An id in `why` with no
 * matching entry in `spans` is dropped rather than guessed at (the same
 * defensive filter debate.ts already applies when building `Claim.evidenceSpans`).
 */
export function blindChallengerInput(interrogation: BlindChallengerBasis, spans: SpanMap): string {
  const evidenceTexts = interrogation.why
    .map((id) => spans[id])
    .filter((text): text is string => Boolean(text));
  const evidence =
    evidenceTexts.length > 0
      ? evidenceTexts.map((text, i) => `[${i + 1}] ${text}`).join("\n")
      : "(no cited evidence)";
  return [`Claim: ${interrogation.what}`, `Mechanism: ${interrogation.how}`, `Cited evidence:\n${evidence}`].join(
    "\n\n",
  );
}
