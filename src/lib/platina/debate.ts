import { extractJson } from "./json";
import {
  AIRouterError,
  routeChatWithProvenance,
  type ProviderId,
} from "@/lib/ai/router";
import {
  nextRoundAllowed,
  resolve,
  type Attack,
  type Claim,
  type ResolveResult,
} from "./contradiction";

/**
 * The challenger may honestly find nothing. An empty or "NONE" objection
 * maps to this marker with zero confounder strength — recorded as such, so
 * the objection rate (R5.1) can distinguish a real attack from a model that
 * objects because it was told to.
 */
export const NO_MATERIAL_OBJECTION = "no material objection";

/** Characters of the built analysis input the proposer sees. */
export const SIGNAL_BUDGET = 6000;

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
  try {
    const independentReply = await challenge({ avoid: [proposal.provider] });
    challengerRaw = independentReply.text;
    challengerProvider = independentReply.provider;
  } catch (error) {
    if (!(error instanceof AIRouterError)) throw error;
    const fallback = await challenge({ prefer: proposal.provider });
    challengerRaw = fallback.text;
    challengerProvider = fallback.provider;
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
    headline: parseHeadline(proposal.text),
    nothingNew: isNothingNew(parseHeadline(proposal.text)),
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
    const parsed = extractJson<Attack>(raw);
    if (!parsed) throw new Error("no JSON in reply");
    const objection = String(parsed.strongestObjection ?? "").trim();
    const noObjection =
      objection === "" ||
      /^none\.?$/i.test(objection) ||
      /^no material objection/i.test(objection);
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
