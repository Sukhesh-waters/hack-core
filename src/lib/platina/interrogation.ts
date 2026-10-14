/**
 * B1 — interrogation schema + falsifier (Metacognitive Brain plan §5 B1).
 * Pure, DB-free: parses and validates the proposer's v2 reply against the
 * numbered input's span map (analysis-input.ts buildNumberedAnalysisInput)
 * and the falsifier metric registry (falsifier-metrics.ts). Nothing here
 * calls a model or touches the DB — `debate.ts runInterrogationRound` is
 * the I/O caller, `signal-analyze.ts` is the DB caller.
 *
 * The brief's rule: "no insight without a testable falsifier." A reply that
 * fails any check below is INVALID — never salvaged into a claim — and the
 * reason is plain operator words ("the claim could not be tested: …"), ready
 * to show as-is (plan §9 operator copy).
 */
import { extractJson } from "./json";
import { quotedIn } from "./events";
import {
  FALSIFIER_METRICS,
  validateFalsifier,
  type FalsifierClaim,
  type FalsifierMetricId,
  type MetricSegment,
  type ValidateFalsifierOptions,
} from "./falsifier-metrics";

/** Bumped whenever INTERROGATION_SYSTEM's contract changes (plan §13). */
export const INTERROGATION_PROMPT_VERSION = "analysis-v2";

/** Shared with debate.ts's v1 proposer: the one cheap, honest "no move here" exit. */
export const NOTHING_NEW = "nothing new";

export type InterrogationKind = "claim" | "fact";
export type FalsifierDirection = "above" | "below";
export type Confidence = "low" | "medium" | "high";

/** The validated shape of a claim's falsifier — identical to falsifier-metrics.ts's FalsifierClaim. */
export type InterrogationFalsifier = FalsifierClaim;

export type Interrogation = {
  headline: string;
  /** One claim or fact, one sentence, no hedging. "nothing new" is a valid cheap exit. */
  what: string;
  /** [eN] ids from the numbered input this rests on. */
  why: string[];
  /** The mechanism — why `what` follows from the cited evidence. */
  how: string;
  kind: InterrogationKind;
  /** Required for kind="claim"; always null for kind="fact". */
  falsifier: InterrogationFalsifier | null;
  /** Recorded for telemetry; NOT scored (contradiction.ts resolve() — see D7/B3). */
  confidence: Confidence;
  /** kind="fact" only: the verbatim quote validated against a cited span. */
  quote?: string;
};

export type ValidateOk = { ok: true; value: Interrogation };
export type ValidateFail = { ok: false; reason: string };
export type ValidateInterrogationResult = ValidateOk | ValidateFail;

/** Deliberately not exported standalone — always go through `validateInterrogation`. */
function isNothingNewWhat(what: string): boolean {
  return /^nothing new\.?$/i.test(what.trim());
}

// ---------------------------------------------------------------------------
// The prompt — metric list generated from the registry, never hand-copied
// ---------------------------------------------------------------------------

/** "engagement_index (windows: 30 or 90 days); topic_momentum (windows: 30 days); …" */
export function metricListText(): string {
  return Object.values(FALSIFIER_METRICS)
    .map((def) => `${def.id} — ${def.label} (windows: ${def.windows.join(" or ")} days)`)
    .join("; ");
}

export const INTERROGATION_SYSTEM = [
  "You read one numbered, public signal about a named competitor. Paragraphs, diff lines and metric lines in the input are tagged [e1], [e2], … — those tags are the ONLY ids you may cite.",
  "Say the one thing this signal shows: what the competitor is now doing or claiming, and why it matters to the named client. Do not summarise or restate the page, and do not invent numbers, dates, prices or results that are not in the input.",
  'Reply JSON only: {"headline":string (max 90 chars, names the competitor and the move), "what":string (ONE sentence, no hedging — never "may"/"might"/"could"/"possibly" — the single claim or fact), "why":string[] (the [eN] ids this rests on), "how":string (the mechanism: why this follows from the cited evidence), "kind":"claim"|"fact" ("fact" only when the page already states this outright — a launch, a hire, attending a show; "claim" for anything inferred or predicted), "falsifier": (REQUIRED when kind is "claim", else null) {"metric":string (one id from the list below, nothing else), "subject":{"brand"?:string,"topic"?:string}, "direction":"above"|"below" (the direction that would prove this claim WRONG), "threshold":number, "window_days":30|90 (must be a window that metric allows)}, "confidence":"low"|"medium"|"high", "quote":string (kind="fact" ONLY: the exact words, copied verbatim from one cited span, that state this fact)}.',
  `If the page holds no move worth reporting, reply with what "${NOTHING_NEW}" and leave the rest minimal — that is a correct answer, not a failure.`,
  `Metrics this system can test a falsifier against: ${metricListText()}. Use no other metric id, and no window_days a metric does not list.`,
].join(" ");

// ---------------------------------------------------------------------------
// Parsing — a reply that is not even valid JSON is invalid, never salvaged
// ---------------------------------------------------------------------------

const ENUM_KIND = new Set(["claim", "fact"]);
const ENUM_CONFIDENCE = new Set(["low", "medium", "high"]);
const ENUM_DIRECTION = new Set(["above", "below"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseFalsifier(raw: unknown): InterrogationFalsifier | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const subjectRaw = f.subject && typeof f.subject === "object" ? (f.subject as Record<string, unknown>) : {};
  const subject: MetricSegment = {
    ...(typeof subjectRaw.brand === "string" ? { brand: subjectRaw.brand } : {}),
    ...(typeof subjectRaw.topic === "string" ? { topic: subjectRaw.topic } : {}),
  };
  return {
    metric: str(f.metric) as FalsifierMetricId,
    subject,
    direction: (ENUM_DIRECTION.has(String(f.direction)) ? f.direction : "") as FalsifierDirection,
    threshold: Number(f.threshold),
    window_days: Number(f.window_days),
  };
}

/**
 * Parses one model reply. Returns `null` on anything that is not a usable
 * JSON object with at least `what`, `kind` and `confidence` — that is a
 * parse failure, and `validateInterrogation` treats it as invalid without
 * trying to salvage a claim from it (plan §5 B1).
 */
export function parseInterrogation(raw: string): Interrogation | null {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = extractJson<Record<string, unknown>>(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const what = str(parsed.what);
  const kind = ENUM_KIND.has(String(parsed.kind)) ? (parsed.kind as InterrogationKind) : null;
  const confidence = ENUM_CONFIDENCE.has(String(parsed.confidence)) ? (parsed.confidence as Confidence) : null;
  if (!what || !kind || !confidence) return null;

  const headline = str(parsed.headline) || what.slice(0, 120);
  const how = str(parsed.how);
  const why = Array.isArray(parsed.why) ? parsed.why.filter((x): x is string => typeof x === "string") : [];
  const falsifier = parseFalsifier(parsed.falsifier);
  const quote = typeof parsed.quote === "string" ? parsed.quote : undefined;

  return { headline, what, why, how, kind, falsifier, confidence, ...(quote !== undefined ? { quote } : {}) };
}

// ---------------------------------------------------------------------------
// Validation — the rule rung. Deterministic; never overridden by the model.
// ---------------------------------------------------------------------------

const MAX_WHAT_CHARS = 220;
const HEDGE_WORDS = /\b(may|might|could|possibly)\b/i;
const SENTENCE_TERMINATORS = /[.!?]/g;

export type ValidateInterrogationOptions = ValidateFalsifierOptions;

/**
 * Rejects (plan §5 B1): a reply that did not parse; `why` empty or citing an
 * id not in `spans`; `what` that is not one claim (more than one sentence
 * terminator, over 220 characters, or a hedge word); `kind="claim"` without
 * a registry-valid falsifier; `kind="fact"` without a verbatim quote inside
 * a cited span. `what = "nothing new"` is a valid, cheap exit that skips
 * every other rule — exactly as today's debate.ts.
 */
export function validateInterrogation(
  parsed: Interrogation | null,
  spans: Record<string, string>,
  opts?: ValidateInterrogationOptions,
): ValidateInterrogationResult {
  if (!parsed) {
    return { ok: false, reason: "The claim could not be tested: the reply could not be read." };
  }

  if (isNothingNewWhat(parsed.what)) {
    return { ok: true, value: parsed };
  }

  if (parsed.why.length === 0) {
    return { ok: false, reason: "The claim could not be tested: it cites no evidence from the input." };
  }
  for (const id of parsed.why) {
    if (!(id in spans)) {
      return {
        ok: false,
        reason: `The claim could not be tested: it cites "${id}", which is not part of the input.`,
      };
    }
  }

  const sentenceCount = (parsed.what.match(SENTENCE_TERMINATORS) ?? []).length;
  if (sentenceCount > 1) {
    return { ok: false, reason: "The claim could not be tested: it is more than one sentence." };
  }
  if (parsed.what.length > MAX_WHAT_CHARS) {
    return {
      ok: false,
      reason: `The claim could not be tested: it is longer than ${MAX_WHAT_CHARS} characters.`,
    };
  }
  if (HEDGE_WORDS.test(parsed.what)) {
    return {
      ok: false,
      reason: 'The claim could not be tested: it hedges ("may", "might", "could" or "possibly").',
    };
  }

  if (parsed.kind === "claim") {
    if (!parsed.falsifier) {
      return { ok: false, reason: "The claim could not be tested: a claim needs a falsifier." };
    }
    const check = validateFalsifier(parsed.falsifier, opts);
    if (!check.ok) {
      return { ok: false, reason: `The claim could not be tested: ${check.reason}.` };
    }
  }

  if (parsed.kind === "fact") {
    const quote = parsed.quote?.trim();
    if (!quote) {
      return { ok: false, reason: "The claim could not be tested: a fact needs a quoted source." };
    }
    const verified = parsed.why.some((id) => quotedIn(quote, spans[id]));
    if (!verified) {
      return {
        ok: false,
        reason: "The claim could not be tested: the quoted words are not in the cited span.",
      };
    }
  }

  return { ok: true, value: parsed };
}

// ---------------------------------------------------------------------------
// TEMPORARY: confidence -> specificity, until B3/D7 removes it from the score
// ---------------------------------------------------------------------------

/**
 * contradiction.ts resolve() still weights `Claim.specificity` (45% today).
 * B1 has nothing deterministic yet to put there for the v2 path, so the
 * proposer's self-reported `confidence` is mapped through as a stand-in —
 * TEMPORARY, and labelled as such in both places. D7/B3 replaces this with
 * validated evidence coverage, confounder strength and falsifier validity,
 * and drops self-reported confidence from the score entirely (plan §5 B3).
 */
export const TEMPORARY_CONFIDENCE_SPECIFICITY: Record<Confidence, number> = {
  low: 0.3,
  medium: 0.6,
  high: 0.9,
};

// ---------------------------------------------------------------------------
// Chunk direction (B1) — the claim's own asserted direction, for B6's
// disconfirming slot (opposite-direction lookup)
// ---------------------------------------------------------------------------

/**
 * `platina_brain_chunks.direction` is the claim's own asserted direction —
 * NOT the falsifier's trigger direction. A falsifier fires when the metric
 * moves the way that would prove the claim WRONG, so it is the mirror of
 * what the claim asserts: a claim that momentum is rising is falsified by
 * momentum falling "below" a floor (claim direction "up"); a claim that
 * pressure is easing is falsified by it rising "above" a ceiling (claim
 * direction "down"). Facts and legacy rows carry no direction.
 */
export function chunkDirectionFor(falsifier: InterrogationFalsifier | null): "up" | "down" | "none" {
  if (!falsifier) return "none";
  if (falsifier.direction === "below") return "up";
  if (falsifier.direction === "above") return "down";
  return "none";
}
