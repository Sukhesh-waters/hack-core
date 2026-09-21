import { enforceAiBudget, logAiUsage } from "@/lib/ai/budget";
import {
  LADDERS,
  REPLY_TOKEN_ALLOWANCE,
  derailment,
  providerCapacity,
  resolveWorkload,
  type Workload,
} from "@/lib/ai/orchestration";
import { estimateTokens } from "@/lib/ai/pricing";
import { bedrockConfigured } from "@/lib/flags";
// extractJson lives in src/lib/platina/json.ts, NOT here: re-exporting it
// through the router broke 31 tests that mock this module wholesale, and
// "@/lib/ai/json" is outside the Platina boundary allowlist.

/**
 * Model router — the single call-site for every AI call (constitution rule).
 * Providers are a config detail behind routeAI: Groq for fast chat, Gemini
 * for chat fallback + embeddings, Bedrock Claude for the quality tier.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
// llama-3.3-70b-versatile and llama-3.1-8b-instant both 404
// ("does not exist or you do not have access to it") on this account as of
// 2026-09-18, live-verified during Platina Slice 14 — the configured key has
// no Llama entitlement. openai/gpt-oss-120b is confirmed reachable with the
// same key and is Groq's comparable general-purpose production model.
const GROQ_MODEL = "openai/gpt-oss-120b";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
/**
 * Gemini chat model candidates, tried in order (2026-09-21).
 *
 * This account has now been broken three times by a single hard-coded model
 * id: gemini-2.0-flash retired, gemini-2.5-pro retired, and gemini-3.6-flash
 * — which the previous round configured — is not on this key's model list at
 * all. Google answers that last case with a free-tier 429, not a 404, so it
 * looked exactly like an exhausted quota and every debate silently fell back
 * to the same provider that proposed.
 *
 * So the id is no longer a single point of failure: the first candidate that
 * answers wins, and the outcome reports which one it was. Live-verified on
 * this key: gemini-2.5-flash 200 in 1.6s, gemini-flash-latest 200 in 4.3s
 * (a thinking model — slower, so it is the backstop, not the default).
 * GEMINI_CHAT_MODEL overrides the head of the list without a deploy.
 */
const GEMINI_CHAT_FALLBACKS = ["gemini-2.5-flash", "gemini-flash-latest"];
const geminiChatModels = (): string[] => {
  const configured = process.env.GEMINI_CHAT_MODEL;
  return [...new Set([...(configured ? [configured] : []), ...GEMINI_CHAT_FALLBACKS])];
};
const GEMINI_CHAT_MODEL = GEMINI_CHAT_FALLBACKS[0];
// text-embedding-004 was retired by Google (404 as of 2026-07); its
// successor defaults to 3072 dims, so every request pins 768 to match
// the pgvector columns. Ranking uses cosine distance, which is scale-
// invariant, so the non-normalized reduced-dim vectors are safe.
const GEMINI_EMBED_MODEL = "gemini-embedding-001";
const NVIDIA_DEFAULT_CHAT_MODEL = "openai/gpt-oss-20b";
const NVIDIA_DEFAULT_EMBED_MODEL = "nvidia/nemotron-3-embed-1b";
const nvidiaBaseUrl = () =>
  (process.env.NVIDIA_NIM_BASE_URL ?? NVIDIA_DEFAULT_BASE_URL).replace(/\/$/, "");
/**
 * NVIDIA chat candidates, tried in order — the configured id first, then the
 * live-verified ones. A list, not one id, because NIM lists 82 models to this
 * key and serves almost none (404 = not enabled, 410 = end of life), and
 * nemotron-3.5-lightning took 76.7s against the 60s timeout: with NVIDIA at
 * the head of the BACKGROUND ladder, a single slow id would cost every job a
 * full minute. modelHealth benches a slow/missing id; the next one answers.
 * NVIDIA_NEMOTRON_MODEL is the older name for NVIDIA_CHAT_MODEL, still read.
 */
const NVIDIA_CHAT_FALLBACKS = [NVIDIA_DEFAULT_CHAT_MODEL, "nvidia/nemotron-3-super-120b-a12b"];
const nvidiaChatModels = (): string[] => {
  const configured = process.env.NVIDIA_CHAT_MODEL ?? process.env.NVIDIA_NEMOTRON_MODEL;
  return [...new Set([...(configured ? [configured] : []), ...NVIDIA_CHAT_FALLBACKS])];
};
const nvidiaEmbedModel = () =>
  process.env.NVIDIA_EMBED_MODEL ?? NVIDIA_DEFAULT_EMBED_MODEL;
// Bedrock model ids carry the anthropic. prefix
const bedrockModel = () =>
  process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-opus-4-8";
// gemini-2.5-pro was retired ("no longer available to new users", 404 as of
// 2026-09, live-verified during Slice 14 — Google's error names
// gemini-3.1-pro-preview as the successor).
// Owner decision 2026-09-20: the quality tier runs on Gemini Flash for now.
// gemini-3.1-pro-preview returns 429 with quota limit 0 on this account's
// free-tier key, so every quality call silently fell through to Groq. Set
// GEMINI_QUALITY_MODEL to a Pro id again once the key has billing.
const geminiQualityModels = (): string[] => {
  const configured = process.env.GEMINI_QUALITY_MODEL;
  return [...new Set([...(configured ? [configured] : []), ...geminiChatModels()])];
};

export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_SPACE_DIMENSIONS = { gemini: 768, nvidia: 2048 } as const;

/** Per-provider wall clock. Longer than any healthy call, shorter than a job. */
export const PROVIDER_TIMEOUT_MS = 60_000;

export type ProviderId = "groq" | "nvidia" | "gemini" | "bedrock";

export class AIRouterError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly status?: number,
    /** Every rung that was tried, when this is a whole-ladder failure. */
    public readonly attempts?: { provider: ProviderId; status?: number }[],
    /**
     * A reply that arrived but was prose where JSON was asked for. Every
     * other rung is tried first; if they all fail, this is still returned —
     * exactly what callers got before the check existed, never worse.
     */
    public derailed?: ChatOutcome,
  ) {
    super(message);
    this.name = "AIRouterError";
  }
}

const derailedOf = (error: unknown): ChatOutcome | undefined =>
  error instanceof AIRouterError ? error.derailed : undefined;

/** Carries the salvageable reply forward on whichever error is rethrown. */
function withDerailed(error: unknown, derailed: ChatOutcome | undefined): unknown {
  if (derailed && error instanceof AIRouterError && !error.derailed) error.derailed = derailed;
  return error;
}

export type ChatTask = {
  kind: "chat";
  prompt: string;
  system?: string;
  json?: boolean;
  /** "fast" (default) or "quality" — see LADDERS in ./orchestration. */
  tier?: "fast" | "quality";
  /**
   * Who is waiting. Defaults to the ambient context: every Inngest job runs
   * as "background", everything else as "interactive". Set it only to
   * override that (e.g. a server action doing bulk work).
   */
  workload?: Workload;
  /**
   * Call ONLY this provider — no fallback. For a caller that must know which
   * provider answered and would rather handle the failure itself. Everything
   * that just wants an answer uses `prefer`.
   */
  pin?: ProviderId;
  /** Preferred first rung, with the rest of the ladder still behind it. */
  prefer?: ProviderId;
  /** Providers this call must not use (debate independence). */
  avoid?: ProviderId[];
};
export type EmbedTask = {
  kind: "embed";
  texts: string[];
  space?: keyof typeof EMBEDDING_SPACE_DIMENSIONS;
  inputType?: "query" | "passage";
};

// ---------------------------------------------------------------------------
// Provider availability — the ladder's memory
// ---------------------------------------------------------------------------

/**
 * A provider that just answered "no quota until tomorrow" or "your key is not
 * valid" will say the same thing to the next fifty calls. Remembering that for
 * a few minutes turns fifty wasted round trips into zero, and — because a
 * cooling provider is moved to the BACK of the ladder rather than removed —
 * it can never leave the ladder empty. Process-local and deliberately small:
 * a restart clears it, which is the correct behaviour after a key is fixed.
 */
const COOLDOWN_MS: Record<"auth" | "daily" | "throttle", number> = {
  auth: 15 * 60_000,
  daily: 60 * 60_000,
  throttle: 60_000,
};

const MODEL_COOLDOWN_MS = { slow: 15 * 60_000, missing: 6 * 60 * 60_000 } as const;
const modelCooldownUntil = new Map<string, number>();

const modelKey = (provider: ProviderId, model: string) => `${provider}:${model}`;

export function classifyModelFailure(error: unknown): keyof typeof MODEL_COOLDOWN_MS | null {
  if (error instanceof AIRouterError && (error.status === 404 || error.status === 410)) {
    return "missing";
  }
  if (error instanceof Error && error.name === "TimeoutError") return "slow";
  return null;
}

export function orderModels(
  models: string[],
  cooling: (model: string) => boolean,
): string[] {
  return [...models.filter((model) => !cooling(model)), ...models.filter(cooling)];
}

export const modelHealth = {
  markFailure(provider: ProviderId, model: string, error: unknown) {
    const kind = classifyModelFailure(error);
    if (kind) modelCooldownUntil.set(modelKey(provider, model), Date.now() + MODEL_COOLDOWN_MS[kind]);
  },
  isCooling(provider: ProviderId, model: string, now = Date.now()) {
    const until = modelCooldownUntil.get(modelKey(provider, model));
    return until !== undefined && until > now;
  },
  markHealthy(provider: ProviderId, model: string) {
    modelCooldownUntil.delete(modelKey(provider, model));
  },
  snapshot(now = Date.now()) {
    return [...modelCooldownUntil.entries()]
      .filter(([, until]) => until > now)
      .map(([key, until]) => ({ key, secondsLeft: Math.ceil((until - now) / 1000) }));
  },
  reset() {
    modelCooldownUntil.clear();
  },
};

const cooldownUntil = new Map<ProviderId, number>();

export function classifyProviderFailure(
  status: number | undefined,
  message: string,
): keyof typeof COOLDOWN_MS | null {
  if (status === 401 || status === 403) return "auth";
  if (/is not set/i.test(message)) return "auth";
  if (status === 429) return /daily quota/i.test(message) ? "daily" : "throttle";
  return null;
}

export const providerHealth = {
  markFailure(provider: ProviderId, status: number | undefined, message: string) {
    const kind = classifyProviderFailure(status, message);
    if (!kind) return;
    cooldownUntil.set(provider, Date.now() + COOLDOWN_MS[kind]);
  },
  isCooling(provider: ProviderId, now: number = Date.now()): boolean {
    const until = cooldownUntil.get(provider);
    return until !== undefined && until > now;
  },
  /** Cleared on a success: the provider is demonstrably back. */
  markHealthy(provider: ProviderId) {
    cooldownUntil.delete(provider);
  },
  snapshot(now: number = Date.now()): { provider: ProviderId; secondsLeft: number }[] {
    return [...cooldownUntil.entries()]
      .filter(([, until]) => until > now)
      .map(([provider, until]) => ({
        provider,
        secondsLeft: Math.ceil((until - now) / 1000),
      }));
  },
  reset() {
    cooldownUntil.clear();
    modelHealth.reset();
  },
};

export function providerConfigured(provider: ProviderId): boolean {
  if (provider === "groq") return Boolean(process.env.GROQ_API_KEY);
  if (provider === "nvidia") return Boolean(process.env.NVIDIA_API_KEY);
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  return bedrockConfigured();
}

/**
 * The ordered providers one chat call may use. Pure — the caller injects
 * configuration and cooldown state, so every rule below is unit-testable.
 *
 * Order: preferred first, then the tier's order for this workload (see
 * LADDERS); unconfigured providers are dropped (no key, no attempt); avoided
 * providers are dropped. Then three bands, each keeping that order:
 *   1. ready      — healthy and with capacity for this call;
 *   2. saturated  — healthy, but its own rate-limit headers say this call
 *                   would not fit right now (it would only earn a 429/413);
 *   3. resting    — cooling down after a failure.
 * Nothing is ever removed for health or capacity, so the ladder is never
 * empty while any provider exists at all.
 */
export function buildLadder(input: {
  tier: "fast" | "quality";
  workload?: Workload;
  prefer?: ProviderId;
  avoid?: ProviderId[];
  /** Estimated tokens this call spends (prompt + reply), for the capacity gate. */
  tokens?: number;
  configured?: (provider: ProviderId) => boolean;
  cooling?: (provider: ProviderId) => boolean;
  affordable?: (provider: ProviderId) => boolean;
}): ProviderId[] {
  const configured = input.configured ?? providerConfigured;
  const cooling = input.cooling ?? ((p: ProviderId) => providerHealth.isCooling(p));
  const tokens = input.tokens ?? 0;
  const affordable =
    input.affordable ?? ((p: ProviderId) => providerCapacity.canAfford(p, tokens));
  const avoid = new Set(input.avoid ?? []);

  const ordered = [
    ...(input.prefer ? [input.prefer] : []),
    ...LADDERS[input.tier][resolveWorkload(input.workload)],
  ].filter(
    (provider, index, all) =>
      all.indexOf(provider) === index &&
      !avoid.has(provider) &&
      configured(provider),
  );
  const resting = ordered.filter((p) => cooling(p));
  const awake = ordered.filter((p) => !cooling(p));
  const ready = awake.filter((p) => affordable(p));
  const saturated = awake.filter((p) => !affordable(p));
  return [...ready, ...saturated, ...resting];
}

/** Internal: provider call result + whatever usage the provider reported. */
type ChatOutcome = {
  text: string;
  provider: ProviderId;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
};

/** Never persist a key: Gemini authenticates via ?key= in the URL. */
function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/key=[^&\s"']+/gi, "key=[redacted]").slice(0, 300);
}

/**
 * Times one provider attempt. A failure is logged as its own zero-cost row
 * before rethrowing, so a fallback success never hides that the primary
 * provider failed (and a total failure still leaves a trace).
 */
async function attempt(
  task: ChatTask,
  provider: ChatOutcome["provider"],
  model: string,
  run: () => Promise<ChatOutcome>,
): Promise<ChatOutcome> {
  const start = Date.now();
  try {
    const outcome = await run();
    // A reply that is not the answer asked for is a failure of THIS model:
    // the next candidate or provider gets a turn. Not a health problem, so
    // it earns no cooldown (neither classifier matches it).
    const reason = derailment(outcome.text, Boolean(task.json));
    if (reason) {
      throw new AIRouterError(
        `${provider} ${model} returned ${reason}`,
        provider,
        undefined,
        undefined,
        reason === "prose instead of JSON"
          ? { ...outcome, latencyMs: Date.now() - start }
          : undefined,
      );
    }
    providerHealth.markHealthy(provider);
    modelHealth.markHealthy(provider, model);
    return { ...outcome, latencyMs: Date.now() - start };
  } catch (error) {
    const message = safeErrorMessage(error);
    providerHealth.markFailure(
      provider,
      error instanceof AIRouterError ? error.status : undefined,
      message,
    );
    modelHealth.markFailure(provider, model, error);
    logAiUsage({
      provider,
      model,
      kind: "chat",
      tier: task.tier ?? "fast",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      status: "failed",
      error: message,
    });
    throw error;
  }
}

const viaGroq = (task: ChatTask) =>
  attempt(task, "groq", GROQ_MODEL, () => groqChat(task));
async function viaNvidia(task: ChatTask): Promise<ChatOutcome> {
  let last: unknown;
  let derailed: ChatOutcome | undefined;
  for (const model of orderModels(nvidiaChatModels(), (m) => modelHealth.isCooling("nvidia", m))) {
    try {
      return await attempt(task, "nvidia", model, () => nvidiaChat(task, model));
    } catch (error) {
      derailed ??= derailedOf(error);
      last = error;
    }
  }
  throw withDerailed(last ?? new AIRouterError("no NVIDIA model configured", "nvidia"), derailed);
}
/**
 * Gemini, trying each candidate model until one answers. A model this key
 * cannot serve is a configuration fault, not an outage: moving to the next
 * candidate costs one round trip and keeps the independent challenger alive.
 * The last failure is rethrown so the ladder can move to another provider.
 */
async function viaGemini(task: ChatTask, models: string[]): Promise<ChatOutcome> {
  let last: unknown;
  let derailed: ChatOutcome | undefined;
  for (const model of orderModels(models, (candidate) => modelHealth.isCooling("gemini", candidate))) {
    try {
      return await attempt(task, "gemini", model, () => geminiChat(task, model));
    } catch (error) {
      derailed ??= derailedOf(error);
      last = error;
    }
  }
  throw withDerailed(last ?? new AIRouterError("no Gemini model configured", "gemini"), derailed);
}
const viaBedrock = (task: ChatTask) =>
  attempt(task, "bedrock", bedrockModel(), () => bedrockChat(task));

export async function routeAI(task: ChatTask): Promise<string>;
export async function routeAI(task: EmbedTask): Promise<number[][]>;
export async function routeAI(
  task: ChatTask | EmbedTask,
): Promise<string | number[][]> {
  // Daily cap (Phase 5): no-op outside a runWithAiCost context.
  await enforceAiBudget();

  if (task.kind === "embed") {
    const start = Date.now();
    let vectors: number[][];
    try {
      vectors = task.space === "nvidia"
        ? await nvidiaEmbed(task.texts, task.inputType ?? "passage")
        : await geminiEmbed(task.texts);
      const expected = EMBEDDING_SPACE_DIMENSIONS[task.space ?? "gemini"];
      if (vectors.some((vector) => vector.length !== expected)) {
        throw new AIRouterError(
          `embedding provider returned the wrong dimensions (expected ${expected})`,
          task.space === "nvidia" ? "nvidia" : "gemini",
        );
      }
    } catch (error) {
      const provider = task.space === "nvidia" ? "nvidia" : "gemini";
      providerHealth.markFailure(
        provider,
        error instanceof AIRouterError ? error.status : undefined,
        safeErrorMessage(error),
      );
      logAiUsage({
        provider,
        model: task.space === "nvidia" ? nvidiaEmbedModel() : GEMINI_EMBED_MODEL,
        kind: "embed",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - start,
        status: "failed",
        error: safeErrorMessage(error),
      });
      throw error;
    }
    const embeddingProvider = task.space === "nvidia" ? "nvidia" : "gemini";
    const embeddingModel = task.space === "nvidia" ? nvidiaEmbedModel() : GEMINI_EMBED_MODEL;
    providerHealth.markHealthy(embeddingProvider);
    logAiUsage({
      provider: embeddingProvider,
      model: embeddingModel,
      kind: "embed",
      tokensIn: task.texts.reduce((sum, t) => sum + estimateTokens(t), 0),
      tokensOut: 0,
      latencyMs: Date.now() - start,
    });
    return vectors;
  }

  return (await routeChat(task)).text;
}

/**
 * The chat ladder plus usage logging, returning which provider/model actually
 * answered. routeAI is the call-site for everything; this exists so the health
 * check can report the provenance of a reply (a retired model id shows up as
 * a fallback here in seconds instead of going unnoticed).
 */
export async function routeChatWithProvenance(
  task: ChatTask,
): Promise<Pick<ChatOutcome, "text" | "provider" | "model" | "latencyMs">> {
  await enforceAiBudget();
  const { text, provider, model, latencyMs } = await routeChat(task);
  return { text, provider, model, latencyMs };
}

/** The provider a healthy ladder answers from first, given current config. */
export function ladderHead(tier: "fast" | "quality"): ProviderId {
  return buildLadder({ tier })[0] ?? (tier === "fast" ? "groq" : "gemini");
}

async function routeChat(task: ChatTask): Promise<ChatOutcome> {
  let outcome: ChatOutcome;
  try {
    outcome = task.pin ? await pinnedChat(task) : await ladderChat(task);
  } catch (error) {
    // Every rung failed, but one of them did answer — in prose where JSON
    // was asked for. Callers already cope with that (extractJson, raw-text
    // fallbacks), so returning it is the pre-check behaviour, not a new risk.
    const salvaged = derailedOf(error);
    if (!salvaged) throw error;
    outcome = salvaged;
  }
  logAiUsage({
    provider: outcome.provider,
    model: outcome.model,
    kind: "chat",
    tier: task.tier ?? "fast",
    tokensIn:
      outcome.tokensIn ??
      estimateTokens(`${task.system ?? ""}${task.prompt}`),
    tokensOut: outcome.tokensOut ?? estimateTokens(outcome.text),
    latencyMs: outcome.latencyMs,
  });
  return outcome;
}

async function pinnedChat(task: ChatTask): Promise<ChatOutcome> {
  if (task.pin === "groq") return viaGroq(task);
  if (task.pin === "nvidia") return viaNvidia(task);
  if (task.pin === "gemini") return viaGemini(task, geminiChatModels());
  return viaBedrock(task);
}

/** One rung. The quality tier asks Gemini for its quality model. */
function callProvider(
  task: ChatTask,
  provider: ProviderId,
): Promise<ChatOutcome> {
  if (provider === "groq") return viaGroq(task);
  if (provider === "nvidia") return viaNvidia(task);
  if (provider === "bedrock") return viaBedrock(task);
  return viaGemini(
    task,
    task.tier === "quality" ? geminiQualityModels() : geminiChatModels(),
  );
}

/**
 * The degradation ladder (constitution: "provider throttled → router swaps
 * provider"). Owner decision 2026-09-21: **any** provider failure moves to the
 * next provider — 404 from a retired model id, 429 from an exhausted daily
 * quota, 401 from a rotated key, a 400 one provider rejects and another
 * accepts, a timeout, a malformed reply. All of them have the same remedy:
 * ask a different model. The cost stays bounded because each rung is tried
 * exactly once and `providerHealth` keeps a known-bad provider at the back of
 * the ladder for the next few minutes.
 *
 * When every rung fails the thrown error names every attempt, so a total
 * outage reads as "groq (404), gemini (429 — daily quota used up)" instead of
 * whichever error happened to be last.
 */
async function ladderChat(task: ChatTask): Promise<ChatOutcome> {
  const ladder = buildLadder({
    tier: task.tier ?? "fast",
    workload: task.workload,
    prefer: task.prefer,
    avoid: task.avoid,
    tokens: estimateTokens(`${task.system ?? ""}${task.prompt}`) + REPLY_TOKEN_ALLOWANCE,
  });
  if (ladder.length === 0) {
    throw new AIRouterError(
      "no AI provider is configured for this call (check GROQ_API_KEY / NVIDIA_API_KEY / GEMINI_API_KEY, or the avoid list)",
      task.prefer ?? "groq",
    );
  }

  const attempts: { provider: ProviderId; status?: number }[] = [];
  let last: unknown;
  let derailed: ChatOutcome | undefined;
  for (const provider of ladder) {
    try {
      return await callProvider(task, provider);
    } catch (error) {
      last = error;
      derailed ??= derailedOf(error);
      attempts.push({
        provider,
        status: error instanceof AIRouterError ? error.status : undefined,
      });
      // The attempt is already logged by `attempt()`; keep going down the ladder.
    }
  }

  const detail = attempts
    .map((a) => `${a.provider}${a.status ? ` (${a.status})` : ""}`)
    .join(", ");
  throw new AIRouterError(
    `every AI provider failed: ${detail} — last error: ${safeErrorMessage(last)}`,
    attempts[attempts.length - 1]?.provider ?? ladder[0],
    attempts[attempts.length - 1]?.status,
    attempts,
    derailed,
  );
}

async function bedrockChat(task: ChatTask): Promise<ChatOutcome> {
  // Mantle client — SigV4 from AWS env creds; lazy import keeps the SDK
  // out of every request that never touches the quality tier.
  const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
  const client = new AnthropicBedrockMantle({
    awsRegion: process.env.AWS_REGION,
  });
  const response = await client.messages.create({
    model: bedrockModel(),
    max_tokens: 4096,
    ...(task.system ? { system: task.system } : {}),
    messages: [{ role: "user", content: task.prompt }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new AIRouterError("Bedrock returned no text", "bedrock");
  }
  return {
    text: block.text,
    provider: "bedrock",
    model: bedrockModel(),
    tokensIn: response.usage?.input_tokens,
    tokensOut: response.usage?.output_tokens,
  };
}

function requireKey(
  name: "GROQ_API_KEY" | "NVIDIA_API_KEY" | "GEMINI_API_KEY",
  provider: "groq" | "nvidia" | "gemini",
): string {
  const key = process.env[name];
  if (!key) throw new AIRouterError(`${name} is not set`, provider);
  return key;
}

async function nvidiaChat(task: ChatTask, model: string): Promise<ChatOutcome> {
  const key = requireKey("NVIDIA_API_KEY", "nvidia");
  const response = await fetch(`${nvidiaBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        ...(task.system ? [{ role: "system", content: task.system }] : []),
        { role: "user", content: task.prompt },
      ],
      ...(task.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new AIRouterError(`NVIDIA request failed (${response.status})`, "nvidia", response.status);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new AIRouterError("NVIDIA returned no content", "nvidia");
  return { text, provider: "nvidia", model, tokensIn: data.usage?.prompt_tokens, tokensOut: data.usage?.completion_tokens };
}

async function groqChat(task: ChatTask): Promise<ChatOutcome> {
  const key = requireKey("GROQ_API_KEY", "groq");
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        ...(task.system ? [{ role: "system", content: task.system }] : []),
        { role: "user", content: task.prompt },
      ],
      ...(task.json ? { response_format: { type: "json_object" } } : {}),
    }),
    // A hung provider must not hang the job that called it: a timeout is a
    // failure like any other, and the ladder moves on to the next provider.
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  // Groq says exactly how much of its minute (8k tokens on this key) and day
  // (1k requests) is left. Recorded on success AND on a 429, so the next
  // ladder skips Groq before it earns another 429 rather than after.
  providerCapacity.observe("groq", response.headers);
  if (!response.ok) {
    throw new AIRouterError(
      `Groq request failed (${response.status})`,
      "groq",
      response.status,
    );
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new AIRouterError("Groq returned no content", "groq");
  }
  return {
    text,
    provider: "groq",
    model: GROQ_MODEL,
    tokensIn: data.usage?.prompt_tokens,
    tokensOut: data.usage?.completion_tokens,
  };
}

/**
 * Tells a daily free-tier quota (nothing helps until it resets) apart from a
 * per-minute rate limit (retrying helps). Reads a bounded slice of the error
 * body; never echoes the body itself.
 */
async function geminiLimitHint(response: Response): Promise<string> {
  if (response.status !== 429) return "";
  try {
    const body = (await response.text()).slice(0, 4000);
    return /PerDay/i.test(body)
      ? " — daily quota used up"
      : /PerMinute/i.test(body)
        ? " — per-minute rate limit"
        : " — quota or rate limit";
  } catch {
    return "";
  }
}

async function geminiChat(
  task: ChatTask,
  model: string = GEMINI_CHAT_MODEL,
): Promise<ChatOutcome> {
  const key = requireKey("GEMINI_API_KEY", "gemini");
  const response = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(task.system
          ? { systemInstruction: { parts: [{ text: task.system }] } }
          : {}),
        contents: [{ role: "user", parts: [{ text: task.prompt }] }],
        ...(task.json
          ? { generationConfig: { responseMimeType: "application/json" } }
          : {}),
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new AIRouterError(
      `Gemini request failed (${response.status})${await geminiLimitHint(response)}`,
      "gemini",
      response.status,
    );
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new AIRouterError("Gemini returned no content", "gemini");
  }
  return {
    text,
    provider: "gemini",
    model,
    tokensIn: data.usageMetadata?.promptTokenCount,
    tokensOut: data.usageMetadata?.candidatesTokenCount,
  };
}

async function geminiEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = requireKey("GEMINI_API_KEY", "gemini");
  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_EMBED_MODEL}:batchEmbedContents?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new AIRouterError(
      `Gemini embed failed (${response.status})`,
      "gemini",
      response.status,
    );
  }
  const data = await response.json();
  const embeddings = Array.isArray(data.embeddings)
    ? data.embeddings.map((e: { values: number[] }) => e.values)
    : null;
  if (!embeddings) {
    throw new AIRouterError("Gemini returned no embeddings", "gemini");
  }
  return embeddings;
}

async function nvidiaEmbed(
  texts: string[],
  inputType: "query" | "passage",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = requireKey("NVIDIA_API_KEY", "nvidia");
  const response = await fetch(`${nvidiaBaseUrl()}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: nvidiaEmbedModel(), input: texts, input_type: inputType }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new AIRouterError(`NVIDIA embed failed (${response.status})`, "nvidia", response.status);
  const data = await response.json();
  const items = Array.isArray(data.data) ? data.data : [];
  const vectors = items
    .sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0))
    .map((item: { embedding?: number[] }) => item.embedding);
  if (vectors.length !== texts.length || vectors.some((vector: unknown) => !Array.isArray(vector))) {
    throw new AIRouterError("NVIDIA returned incomplete embeddings", "nvidia");
  }
  const invalid = vectors.find((vector: number[]) => vector.length !== EMBEDDING_SPACE_DIMENSIONS.nvidia);
  if (invalid) {
    throw new AIRouterError(
      `NVIDIA embedding model returned ${invalid.length} dimensions, expected ${EMBEDDING_SPACE_DIMENSIONS.nvidia}`,
      "nvidia",
    );
  }
  return vectors as number[][];
}
