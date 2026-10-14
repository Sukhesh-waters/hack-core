import { extractJson } from "./json";
import {
  AIRouterError,
  routeChatWithProvenance,
  type ProviderId,
} from "@/lib/ai/router";
import { deterministicShare, type BrainMode } from "./brain-modes";
import { BLIND_CHALLENGER_SYSTEM, blindChallengerInput } from "./challenger";
import {
  nextRoundAllowed,
  resolve,
  resolveV2,
  type Attack,
  type Claim,
  type ResolveResult,
  type ResolveState,
} from "./contradiction";
import { validateFalsifier } from "./falsifier-metrics";
import {
  INTERROGATION_PROMPT_VERSION,
  INTERROGATION_SYSTEM,
  TEMPORARY_CONFIDENCE_SPECIFICITY,
  parseInterrogation,
  validateInterrogation,
  type Interrogation,
  type ValidateInterrogationOptions,
  type ValidateInterrogationResult,
} from "./interrogation";

/**
 * The challenger may honestly find nothing. An empty or "NONE" objection
 * maps to this marker with zero confounder strength — recorded as such, so
 * the objection rate (R5.1) can distinguish a real attack from a model that
 * objects because it was told to.
 */
export const NO_MATERIAL_OBJECTION = "no material objection";

/** Characters of the built analysis input the proposer sees. */
export const SIGNAL_BUDGET = 6000;

/**
 * Bumped whenever PROPOSER_SYSTEM or CHALLENGER_SYSTEM changes. Stored on
 * every transcript (B0) so objection rates and agreement-by-model are never
 * compared across prompt versions (plan §13).
 */
export const ANALYSIS_PROMPT_VERSION = "analysis-v1";

/** Said when the page carries no move worth reporting. */
export const NOTHING_NEW = "nothing new";

/**
 * The proposer's brief (core spine R2). It is handed an input that names the
 * competitor, the client, the source and what changed (see analysis-input.ts),
 * so it is asked for the one thing that input makes possible: what this named
 * competitor is now doing, what is new about it, and why the named client
 * should care. Restating the page is explicitly not an answer, and
 * "nothing new" is an allowed — often correct — reply.
 */
export const PROPOSER_SYSTEM = [
  "You read one public signal about a named competitor and report what it shows.",
  "Say what this competitor is now doing or claiming, what is NEW about it, and why it matters to the client named in the input.",
  "Do not summarise or restate the page. Do not describe what kind of page it is. Do not invent numbers, dates, prices or results that are not in the input.",
  `If the page is ordinary marketing copy with no move in it, reply with headline "${NOTHING_NEW}" and specificity 0.1 — that is a correct answer, not a failure.`,
  'Reply JSON only: {"headline":string (max 90 chars, names the competitor and the move), "text":string (2-3 sentences: the move, the evidence, why it matters), "noveltyReason":string (what makes this new, or why it is not), "evidenceSpans":string[] (short quotes from the input), "specificity":number 0-1}.',
].join(" ");

/**
 * The challenger's brief. Round 3 asked only for confounders; a page that says
 * nothing in particular sails through that. So genericness is now an objection
 * it is asked for by name — the single most common defect in this pipeline's
 * output.
 */
export const CHALLENGER_SYSTEM = [
  "You attack the claim made about a competitor signal.",
  "Judge three things: (1) is this actually NEW, or is it ordinary marketing copy any competitor in this market would publish? (2) does the input really support it, or was it inferred? (3) what else could explain it — confounders.",
  "A claim that would be true of almost any company in this market is a weak claim: say so, and give it a high confounder strength.",
  'Reply JSON only: {"text":string, "confounders":string[], "strongestObjection":string (or "none"), "confounderStrength":number 0-1}.',
].join(" ");

/** Stored with the outcome when the independent challenger was unavailable. */
export const SAME_PROVIDER_CAVEAT =
  "The independent challenger (a different provider) was unavailable, so the same provider that proposed this also challenged it. Treat it as less tested.";

/**
 * A round whose challenge was not independent can never read "agreed": there is
 * no second, unrelated model behind it. It is qualified, with the reason kept.
 */
export function downgradeIfNotIndependent(
  result: ResolveResult,
  independent: boolean,
): ResolveResult {
  if (independent) return result;
  const caveat = [result.caveat, SAME_PROVIDER_CAVEAT]
    .filter(Boolean)
    .join(" ");
  return result.state === "agreed"
    ? { ...result, state: "qualified", caveat }
    : { ...result, caveat };
}

export async function runContradictionRound(
  rawSignal: string,
  floors?: { contestedFloor?: number; qualifiedFloor?: number },
) {
  if (nextRoundAllowed()) {
    throw new Error("unreachable: a second contradiction round is forbidden");
  }

  // The proposer takes the head of the router's ladder for this workload —
  // NVIDIA inside an Inngest job, Groq when a person is waiting — and is never
  // pinned: a retired model id or a rotated key must not stop analysis. Groq
  // is deliberately NOT preferred here: its 8k-tokens-per-minute budget went
  // on background debates and left interactive calls with 429s.
  const proposal = await routeChatWithProvenance({
    kind: "chat",
    json: true,
    system: PROPOSER_SYSTEM,
    prompt: rawSignal.slice(0, SIGNAL_BUDGET),
  });

  const challenge = (routing: { avoid?: ProviderId[]; prefer?: ProviderId }) =>
    routeChatWithProvenance({
      kind: "chat",
      ...routing,
      json: true,
      system: CHALLENGER_SYSTEM,
      prompt: `Signal:\n${rawSignal.slice(0, SIGNAL_BUDGET / 2)}\n\nClaim:\n${proposal.text}`,
    });

  // Independence is a property of who actually answered, not of who we asked.
  // First try any provider EXCEPT the proposer's; if none can (all out of
  // quota, keys missing, every rung failing), fall back to the proposer's own
  // provider rather than dropping the document — and record that honestly.
  let challengerRaw: string;
  let challengerProvider: ProviderId;
  let challengerModel: string;
  try {
    const independentReply = await challenge({ avoid: [proposal.provider] });
    challengerRaw = independentReply.text;
    challengerProvider = independentReply.provider;
    challengerModel = independentReply.model;
  } catch (error) {
    if (!(error instanceof AIRouterError)) throw error;
    const fallback = await challenge({ prefer: proposal.provider });
    challengerRaw = fallback.text;
    challengerProvider = fallback.provider;
    challengerModel = fallback.model;
  }
  const independent = challengerProvider !== proposal.provider;

  const claim = parseClaim(proposal.text);
  const attack = parseAttack(challengerRaw);
  const result = downgradeIfNotIndependent(
    resolve(claim, attack, floors),
    independent,
  );
  return {
    claim,
    attack,
    result,
    independent,
    providers: { proposer: proposal.provider, challenger: challengerProvider },
    // B0: provenance for the agreement-by-model metric (plan §8) and B2's
    // blind-challenger A/B — recorded now so neither needs a schema change.
    models: { proposer: proposal.model, challenger: challengerModel },
    // Recorded for the objection-rate metric. NO_MATERIAL_OBJECTION is the
    // marker parseAttack normalises an honest "no objection" reply to,
    // whatever literal words the model used.
    objected: attack.strongestObjection !== NO_MATERIAL_OBJECTION,
    headline: parseHeadline(proposal.text),
    nothingNew: isNothingNew(parseHeadline(proposal.text)),
  };
}

/** The deterministic 50/50 split salt for the B2 shadow arm (plan §5 B2, §2.1). */
export const BLIND_CHALLENGER_SHADOW_SALT = "b2-blind";

/** `runInterrogationRound`'s 4th argument — absent/undefined means mode "off" (today's unblinded challenger, unconditionally). */
export type ChallengerRoundOptions = {
  /** The signal document id — the input to the shadow arm's deterministic split. */
  signalId: string;
  mode: BrainMode;
};

/** `runInterrogationRound`'s 5th argument (B3, D7) — absent/undefined means mode "off" (today's v1 `resolve()`, unconditionally). */
export type GateRoundOptions = {
  mode: BrainMode;
};

/** Shadow-only telemetry (plan §5 B3: "log telemetry (stage 'gate', detail { oldState, newState, changed })"). Present only when gate mode is "shadow". */
export type GateResolveShadow = {
  oldState: ResolveState;
  newState: ResolveState;
  changed: boolean;
};

/**
 * B1 — the interrogation v2 round (plan §5 B1). Same one-call-then-challenge
 * shape as `runContradictionRound` (kept untouched above, for mode="off").
 *
 * B2 (plan §5 B2) decides, per call, whether the challenger sees today's
 * prompt (`CHALLENGER_SYSTEM` + the raw signal and proposer JSON) or the
 * blind one (`BLIND_CHALLENGER_SYSTEM` + `blindChallengerInput` — only
 * `what`, `how` and the cited spans' texts): `challengerOpts` absent, or its
 * `mode` "off", always uses today's prompt; "shadow" splits 50/50 by
 * `deterministicShare(signalId, 0.5, "b2-blind")`; "on" always blinds. This
 * is the challenger's OWN mode (`modeOf(config, "challenger")`), independent
 * of the interrogation mode that got this function called in the first
 * place — there is no code path where interrogation is "off" and this
 * function runs at all (that is `runContradictionRound`'s v1 round above,
 * which has no numbered spans to blind with, so a challenger mode is simply
 * never consulted there).
 *
 * The proposer's reply is parsed once, before the challenge call (both the
 * blind prompt and the return value need `what`/`how`/`why`), and validated
 * (interrogation.ts) against the numbered input's span map before
 * `resolve()` ever sees it: `Claim.text = what`, `evidenceSpans` = the cited
 * spans' own texts, and `specificity` = the TEMPORARY confidence mapping
 * (D7/B3 replaces this). An invalid reply still produces a
 * `Claim`/`Attack`/`ResolveResult` (the caller needs *something* to write a
 * transcript from), but `interrogation` on the return carries the
 * validation failure so `signal-analyze.ts` can act on it (shadow:
 * grade_state "insufficient"; on: skip, no Brain write).
 *
 * B3 (D7): the 5th argument, `gateOpts`, is the GATE's own mode
 * (`modeOf(config, "gate")`), independent of interrogation/challenger mode —
 * it only has an effect here because this IS the v2 round (the v1 round,
 * `runContradictionRound` above, never consults it: there is no validated
 * evidence coverage or falsifier to build a v2 score from there). "off"
 * (absent/undefined) keeps today's `resolve()` unconditionally. "shadow"
 * computes BOTH `resolve()` and `resolveV2()`, returns the OLD (v1) result
 * as `result` (today's behaviour, unchanged), and carries the comparison in
 * `gateShadow` for the caller to log. "on" returns `resolveV2()`'s result as
 * `result` — `TEMPORARY_CONFIDENCE_SPECIFICITY` still computes `claim.specificity`
 * below (so `claim` keeps its shape for callers/tests), but resolveV2 has no
 * parameter to read it from, which is what drops it from the decision; the
 * model's stated `confidence` stays on the return value for telemetry only.
 */
/** Validated citations at which resolveV2's evidence support is full (1.0). */
export const SUPPORTING_SPANS = 2;

export async function runInterrogationRound(
  numbered: { input: string; spans: Record<string, string> },
  floors?: { contestedFloor?: number; qualifiedFloor?: number },
  validateOpts?: ValidateInterrogationOptions,
  challengerOpts?: ChallengerRoundOptions,
  gateOpts?: GateRoundOptions,
) {
  if (nextRoundAllowed()) {
    throw new Error("unreachable: a second contradiction round is forbidden");
  }

  const proposal = await routeChatWithProvenance({
    kind: "chat",
    json: true,
    system: INTERROGATION_SYSTEM,
    prompt: numbered.input.slice(0, SIGNAL_BUDGET),
  });

  // Parsed once, early: the blind prompt (if this round uses one) and the
  // return value both need `what`/`how`/`why`, and parseInterrogation is
  // pure and cheap — no reason to call it twice over the same reply.
  const parsed: Interrogation | null = parseInterrogation(proposal.text);

  const challengerMode = challengerOpts?.mode ?? "off";
  const blinded =
    challengerMode === "on" ||
    (challengerMode === "shadow" &&
      challengerOpts !== undefined &&
      deterministicShare(challengerOpts.signalId, 0.5, BLIND_CHALLENGER_SHADOW_SALT));

  // A failed parse leaves nothing structured to blind with; blinding then
  // degrades to "the claim as best understood" with no cited evidence
  // (`why: []`) rather than falling back to the unblinded prompt — a parse
  // failure must never be the reason a challenger gets to see provenance.
  const blindBasis = parsed ?? { what: proposal.text.slice(0, 400), how: "", why: [] };

  const challenge = (routing: { avoid?: ProviderId[]; prefer?: ProviderId }) =>
    routeChatWithProvenance({
      kind: "chat",
      ...routing,
      json: true,
      system: blinded ? BLIND_CHALLENGER_SYSTEM : CHALLENGER_SYSTEM,
      prompt: blinded
        ? blindChallengerInput(blindBasis, numbered.spans)
        : `Signal:\n${numbered.input.slice(0, SIGNAL_BUDGET / 2)}\n\nClaim:\n${proposal.text}`,
    });

  let challengerRaw: string;
  let challengerProvider: ProviderId;
  let challengerModel: string;
  try {
    const independentReply = await challenge({ avoid: [proposal.provider] });
    challengerRaw = independentReply.text;
    challengerProvider = independentReply.provider;
    challengerModel = independentReply.model;
  } catch (error) {
    if (!(error instanceof AIRouterError)) throw error;
    const fallback = await challenge({ prefer: proposal.provider });
    challengerRaw = fallback.text;
    challengerProvider = fallback.provider;
    challengerModel = fallback.model;
  }
  const independent = challengerProvider !== proposal.provider;

  const interrogation: ValidateInterrogationResult = validateInterrogation(
    parsed,
    numbered.spans,
    validateOpts,
  );

  // A transcript is written whether or not the interrogation validated —
  // the audit trail (plan §11) keeps every model reply, valid or not.
  const claim: Claim = {
    text: interrogation.ok ? interrogation.value.what : parsed?.what ?? proposal.text.slice(0, 400),
    evidenceSpans: interrogation.ok
      ? interrogation.value.why.map((id) => numbered.spans[id]).filter((text): text is string => Boolean(text))
      : [],
    specificity: TEMPORARY_CONFIDENCE_SPECIFICITY[parsed?.confidence ?? "medium"],
  };
  const attack = parseAttack(challengerRaw);
  const v1Result = downgradeIfNotIndependent(resolve(claim, attack, floors), independent);

  // B3 (D7): deterministic inputs ONLY — nothing the proposer reported about
  // itself. `evidenceCoverage` is checked against the input's own span map
  // (not what the model claimed to cite), `falsifierValid` is a registry
  // lookup (facts are falsifier-exempt, D1), `confounderStrength` is the
  // challenger's own judgement — the same value resolve() already uses.
  // Support strength, not page coverage: dividing by every span the page
  // offered made a sound claim on a long page (2 of 40 spans) score 0.05 and
  // land "contested" for the page's length, not the claim's support.
  const citedValidated = interrogation.ok ? interrogation.value.why.length : 0;
  const evidenceCoverage = Math.min(1, citedValidated / SUPPORTING_SPANS);
  const falsifierValid =
    parsed === null
      ? false
      : parsed.kind === "fact"
        ? true
        : parsed.falsifier !== null && validateFalsifier(parsed.falsifier, validateOpts).ok;

  const gateMode = gateOpts?.mode ?? "off";
  let result = v1Result;
  let gateShadow: GateResolveShadow | undefined;
  if (gateMode !== "off") {
    const v2Result = downgradeIfNotIndependent(
      resolveV2(
        { evidenceCoverage, confounderStrength: attack.confounderStrength, falsifierValid, strongestObjection: attack.strongestObjection },
        floors,
      ),
      independent,
    );
    if (gateMode === "shadow") {
      gateShadow = { oldState: v1Result.state, newState: v2Result.state, changed: v1Result.state !== v2Result.state };
    } else {
      result = v2Result;
    }
  }

  return {
    claim,
    attack,
    result,
    independent,
    providers: { proposer: proposal.provider, challenger: challengerProvider },
    models: { proposer: proposal.model, challenger: challengerModel },
    objected: attack.strongestObjection !== NO_MATERIAL_OBJECTION,
    headline: parsed?.headline ?? null,
    nothingNew: parsed !== null && /^nothing new\.?$/i.test(parsed.what.trim()),
    /** The B1 validation outcome — what signal-analyze.ts branches on for shadow/on. */
    interrogation,
    /** The best-effort parse, valid or not — analysis-writes.ts's v2 path needs it even when `interrogation.ok` is false (shadow still writes a chunk off it). */
    parsed,
    promptVersion: INTERROGATION_PROMPT_VERSION,
    /** B2 — whether THIS round's challenger saw the blind prompt. False when challengerOpts is absent/"off", or "shadow" lost its coin flip. Stored on the transcript's `blinded` column. */
    blinded,
    /** B3 — only set when gate mode is "shadow": what resolveV2 would have decided instead of today's `resolve()`, for signal-analyze.ts to log (stage "gate"). */
    gateShadow,
  };
}

/** The model's own one-line naming of the move. Null when it gave none. */
export function parseHeadline(raw: string): string | null {
  try {
    const parsed = extractJson<{ headline?: unknown }>(raw);
    if (!parsed) return null;
    const headline =
      typeof parsed.headline === "string" ? parsed.headline.trim() : "";
    return headline.length > 0 ? headline.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** True when the proposer honestly reported that the page holds no move. */
export function isNothingNew(headline: string | null): boolean {
  return (
    headline !== null &&
    new RegExp(`^${NOTHING_NEW}\\.?$`, "i").test(headline.trim())
  );
}

function parseClaim(raw: string): Claim {
  try {
    const parsed = extractJson<Claim>(raw);
    if (!parsed) throw new Error("no JSON in reply");
    return {
      text: String(parsed.text ?? raw),
      evidenceSpans: Array.isArray(parsed.evidenceSpans)
        ? parsed.evidenceSpans
        : [],
      specificity: Number(parsed.specificity ?? 0.5),
    };
  } catch {
    return { text: raw.slice(0, 400), evidenceSpans: [], specificity: 0.5 };
  }
}

/** Exported for tests; the round runner above is the only production caller. */
export function parseAttack(raw: string): Attack {
  try {
    const parsed = extractJson<Attack & { verdict?: unknown }>(raw);
    if (!parsed) throw new Error("no JSON in reply");
    const objection = String(parsed.strongestObjection ?? "").trim();
    const textSaysNoObjection =
      objection === "" ||
      /^none\.?$/i.test(objection) ||
      /^no material objection/i.test(objection);
    // B2: BLIND_CHALLENGER_SYSTEM asks for an explicit `verdict` field, which
    // wins over the text heuristic above when present and recognised. A
    // reply with no `verdict` (every v1 reply, and today's unblinded v2
    // reply — neither prompt asks for one) falls back to that heuristic
    // unchanged, so this is additive, not a behaviour change, for every
    // existing caller.
    const verdict = typeof parsed.verdict === "string" ? parsed.verdict : null;
    const noObjection =
      verdict === "no_material_objection" ? true : verdict === "objection" ? false : textSaysNoObjection;
    return {
      text: String(parsed.text ?? raw),
      confounders: Array.isArray(parsed.confounders) ? parsed.confounders : [],
      strongestObjection: noObjection ? NO_MATERIAL_OBJECTION : objection,
      confounderStrength: noObjection
        ? 0
        : Number(parsed.confounderStrength ?? 0.5),
    };
  } catch {
    return {
      text: raw.slice(0, 400),
      confounders: [],
      strongestObjection: raw.slice(0, 160),
      confounderStrength: 0.5,
    };
  }
}
