import { enforceAiBudget, logAiUsage } from "@/lib/ai/budget";
import { estimateTokens } from "@/lib/ai/pricing";
import { bedrockConfigured } from "@/lib/flags";

/**
 * Model router — the single call-site for every AI call (constitution rule).
 * Providers are a config detail behind routeAI: Groq for fast chat, Gemini
 * for chat fallback + embeddings, Bedrock Claude for the quality tier.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// llama-3.3-70b-versatile and llama-3.1-8b-instant both 404
// ("does not exist or you do not have access to it") on this account as of
// 2026-09-18, live-verified during Platina Slice 14 — the configured key has
// no Llama entitlement. openai/gpt-oss-120b is confirmed reachable with the
// same key and is Groq's comparable general-purpose production model.
const GROQ_MODEL = "openai/gpt-oss-120b";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
// gemini-2.0-flash was retired (404 as of 2026-09, live-verified during
// Platina Slice 14 — Google's error names gemini-3.6-flash as the successor).
const GEMINI_CHAT_MODEL = "gemini-3.6-flash";
// text-embedding-004 was retired by Google (404 as of 2026-07); its
// successor defaults to 3072 dims, so every request pins 768 to match
// the pgvector columns. Ranking uses cosine distance, which is scale-
// invariant, so the non-normalized reduced-dim vectors are safe.
const GEMINI_EMBED_MODEL = "gemini-embedding-001";
// Bedrock model ids carry the anthropic. prefix
const bedrockModel = () =>
  process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-opus-4-8";
// gemini-2.5-pro was retired ("no longer available to new users", 404 as of
// 2026-09, live-verified during Slice 14 — Google's error names
// gemini-3.1-pro-preview as the successor).
const geminiQualityModel = () =>
  process.env.GEMINI_QUALITY_MODEL ?? "gemini-3.1-pro-preview";

export const EMBEDDING_DIMENSIONS = 768;

export class AIRouterError extends Error {
  constructor(
    message: string,
    public readonly provider: "groq" | "gemini" | "bedrock",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AIRouterError";
  }
}

export type ChatTask = {
  kind: "chat";
  prompt: string;
  system?: string;
  json?: boolean;
  /** "fast" (default): Groq→Gemini. "quality": Bedrock→Gemini Pro→Groq. */
  tier?: "fast" | "quality";
  /** Bypass the ladder and call this provider only (Platina debate pin). */
  pin?: "groq" | "gemini" | "bedrock";
};
export type EmbedTask = { kind: "embed"; texts: string[] };

/** Internal: provider call result + whatever usage the provider reported. */
type ChatOutcome = {
  text: string;
  provider: "groq" | "gemini" | "bedrock";
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
    return { ...outcome, latencyMs: Date.now() - start };
  } catch (error) {
    logAiUsage({
      provider,
      model,
      kind: "chat",
      tier: task.tier ?? "fast",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      status: "failed",
      error: safeErrorMessage(error),
    });
    throw error;
  }
}

const viaGroq = (task: ChatTask) =>
  attempt(task, "groq", GROQ_MODEL, () => groqChat(task));
const viaGemini = (task: ChatTask, model: string = GEMINI_CHAT_MODEL) =>
  attempt(task, "gemini", model, () => geminiChat(task, model));
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
      vectors = await geminiEmbed(task.texts);
    } catch (error) {
      logAiUsage({
        provider: "gemini",
        model: GEMINI_EMBED_MODEL,
        kind: "embed",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - start,
        status: "failed",
        error: safeErrorMessage(error),
      });
      throw error;
    }
    logAiUsage({
      provider: "gemini",
      model: GEMINI_EMBED_MODEL,
      kind: "embed",
      tokensIn: task.texts.reduce((sum, t) => sum + estimateTokens(t), 0),
      tokensOut: 0,
      latencyMs: Date.now() - start,
    });
    return vectors;
  }

  const outcome = task.pin
    ? await pinnedChat(task)
    : task.tier === "quality"
      ? await qualityChat(task)
      : await fastChat(task);
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
  return outcome.text;
}

async function pinnedChat(task: ChatTask): Promise<ChatOutcome> {
  if (task.pin === "groq") return viaGroq(task);
  if (task.pin === "gemini") return viaGemini(task);
  return viaBedrock(task);
}

async function fastChat(task: ChatTask): Promise<ChatOutcome> {
  try {
    return await viaGroq(task);
  } catch (error) {
    // Degradation ladder: provider throttled, down, or unable to serve the
    // configured model (404 — e.g. a retired/inaccessible model id, the
    // same failure mode that broke this call entirely until GROQ_MODEL was
    // corrected) → swap provider rather than fail the whole request.
    const swappable =
      error instanceof AIRouterError &&
      error.provider === "groq" &&
      (error.status === 404 ||
        error.status === 429 ||
        (error.status ?? 0) >= 500);
    if (swappable) return viaGemini(task);
    throw error;
  }
}

/**
 * Quality tier degradation ladder: Bedrock Claude → Gemini Pro → Groq.
 * Bedrock is skipped entirely when AWS creds are absent (external dep:
 * verify in-region availability — WEEKLY_PLAN §5).
 */
async function qualityChat(task: ChatTask): Promise<ChatOutcome> {
  if (bedrockConfigured()) {
    try {
      return await viaBedrock(task);
    } catch {
      // fall through the ladder — the failed attempt is already logged
    }
  }
  try {
    return await viaGemini(task, geminiQualityModel());
  } catch {
    return viaGroq(task);
  }
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
  name: "GROQ_API_KEY" | "GEMINI_API_KEY",
  provider: "groq" | "gemini",
): string {
  const key = process.env[name];
  if (!key) throw new AIRouterError(`${name} is not set`, provider);
  return key;
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
  });
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
    },
  );
  if (!response.ok) {
    throw new AIRouterError(
      `Gemini request failed (${response.status})`,
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
