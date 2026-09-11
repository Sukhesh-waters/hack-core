import { enforceAiBudget, logAiUsage } from "@/lib/ai/budget";
import { estimateTokens } from "@/lib/ai/pricing";
import { bedrockConfigured } from "@/lib/flags";

/**
 * Model router — the single call-site for every AI call (constitution rule).
 * Providers are a config detail behind routeAI: Groq for fast chat, Gemini
 * for chat fallback + embeddings, Bedrock Claude for the quality tier.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_CHAT_MODEL = "gemini-2.0-flash";
// text-embedding-004 was retired by Google (404 as of 2026-07); its
// successor defaults to 3072 dims, so every request pins 768 to match
// the pgvector columns. Ranking uses cosine distance, which is scale-
// invariant, so the non-normalized reduced-dim vectors are safe.
const GEMINI_EMBED_MODEL = "gemini-embedding-001";
// Bedrock model ids carry the anthropic. prefix
const bedrockModel = () =>
  process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-opus-4-8";
const geminiQualityModel = () =>
  process.env.GEMINI_QUALITY_MODEL ?? "gemini-2.5-pro";

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
};

export async function routeAI(task: ChatTask): Promise<string>;
export async function routeAI(task: EmbedTask): Promise<number[][]>;
export async function routeAI(
  task: ChatTask | EmbedTask,
): Promise<string | number[][]> {
  // Daily cap (Phase 5): no-op outside a runWithAiCost context.
  await enforceAiBudget();

  if (task.kind === "embed") {
    const vectors = await geminiEmbed(task.texts);
    logAiUsage({
      provider: "gemini",
      model: GEMINI_EMBED_MODEL,
      kind: "embed",
      tokensIn: task.texts.reduce((sum, t) => sum + estimateTokens(t), 0),
      tokensOut: 0,
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
  });
  return outcome.text;
}

async function pinnedChat(task: ChatTask): Promise<ChatOutcome> {
  if (task.pin === "groq") return groqChat(task);
  if (task.pin === "gemini") return geminiChat(task);
  return bedrockChat(task);
}

async function fastChat(task: ChatTask): Promise<ChatOutcome> {
  try {
    return await groqChat(task);
  } catch (error) {
    // Degradation ladder: provider throttled or down → swap provider.
    const swappable =
      error instanceof AIRouterError &&
      error.provider === "groq" &&
      (error.status === 429 || (error.status ?? 0) >= 500);
    if (swappable) return geminiChat(task);
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
      return await bedrockChat(task);
    } catch {
      // fall through the ladder
    }
  }
  try {
    return await geminiChat(task, geminiQualityModel());
  } catch {
    return groqChat(task);
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
