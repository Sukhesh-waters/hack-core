import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIRouterError,
  buildLadder,
  classifyProviderFailure,
  modelHealth,
  providerHealth,
  routeAI,
  routeChatWithProvenance,
} from "./router";

const bedrockCreate = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  AnthropicBedrockMantle: class {
    messages = { create: bedrockCreate };
  },
}));

/** How many Gemini model ids the router tries before writing the rung off. */
const GEMINI_CANDIDATES = 2;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  // The ladder's cooldown memory is module-level: a failure in one test would
  // otherwise re-order the ladder in the next one. Same for model memory.
  providerHealth.reset();
  modelHealth.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  providerHealth.reset();
  modelHealth.reset();
});

describe("routeAI chat", () => {
  it("routes chat to Groq and returns the completion text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: "hello back" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "hello" })).resolves.toBe(
      "hello back",
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.groq.com");
  });

  it("falls back to Gemini when Groq throttles (degradation ladder)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "hello" })).resolves.toBe(
      "gemini says hi",
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });

  it("falls back to Gemini when Groq can't serve the configured model (404)", async () => {
    // Live-verified failure mode (Slice 14): a retired or inaccessible
    // model id 404s exactly like a throttle from the caller's perspective
    // — it should degrade the same way, not fail the whole request.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "model not found" }, 404),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "hello" })).resolves.toBe(
      "gemini says hi",
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });

  // Owner decision 2026-09-21 (round 4): this used to stop at the first 400 on
  // the theory that a caller bug fails everywhere. It does not — a request one
  // provider rejects is often one another accepts (json mode, system prompts,
  // token ceilings) — and the owner's rule is now explicit: ANY provider
  // error moves to the next provider.
  it("falls back to the next provider on a 400 too", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "bad request" }, 400))
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "gemini took it" }] } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "x" })).resolves.toBe(
      "gemini took it",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names every provider it tried when the whole ladder fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "gone" }, 404))
      // Gemini is tried once per candidate model before the rung is written off.
      .mockImplementation(() => jsonResponse({ error: "quota" }, 429));
    vi.stubGlobal("fetch", fetchMock);

    const error = await routeAI({ kind: "chat", prompt: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(AIRouterError);
    expect(error.message).toContain("every AI provider failed");
    expect(error.message).toContain("groq (404)");
    expect(error.message).toContain("gemini (429)");
    expect(error.attempts).toEqual([
      { provider: "groq", status: 404 },
      { provider: "gemini", status: 429 },
    ]);
  });

  it("tries each rung exactly once — a failing ladder cannot loop", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ error: "down" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await routeAI({ kind: "chat", prompt: "x" }).catch(() => null);
    // groq once, then Gemini once per candidate model. No bedrock (no AWS
    // creds here) and no retry of a rung that already answered.
    expect(fetchMock).toHaveBeenCalledTimes(1 + GEMINI_CANDIDATES);
  });

  it("a timeout is a failure like any other and swaps provider", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("The operation was aborted"), {
          name: "TimeoutError",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "gemini answered" }] } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "x" })).resolves.toBe(
      "gemini answered",
    );
  });

  it("a missing key skips that provider instead of failing the call", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "gemini only" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "x" })).resolves.toBe(
      "gemini only",
    );
    // Groq was never called: an unconfigured provider is not a rung.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });
});

describe("ladder construction (pure)", () => {
  const all = () => true;

  it("puts the preferred provider first and keeps the rest behind it", () => {
    expect(
      buildLadder({ tier: "fast", prefer: "gemini", configured: all, cooling: () => false }),
    ).toEqual(["gemini", "groq", "bedrock"]);
  });

  it("drops avoided providers — independence is not negotiable", () => {
    expect(
      buildLadder({ tier: "fast", avoid: ["groq"], configured: all, cooling: () => false }),
    ).toEqual(["gemini", "bedrock"]);
  });

  it("drops unconfigured providers", () => {
    expect(
      buildLadder({
        tier: "quality",
        configured: (p) => p !== "bedrock",
        cooling: () => false,
      }),
    ).toEqual(["gemini", "groq"]);
  });

  it("moves a cooling provider to the back rather than removing it", () => {
    expect(
      buildLadder({
        tier: "fast",
        configured: all,
        cooling: (p) => p === "groq",
      }),
    ).toEqual(["gemini", "bedrock", "groq"]);
  });

  it("never returns an empty ladder while any provider is configured", () => {
    expect(
      buildLadder({ tier: "fast", configured: (p) => p === "groq", cooling: () => true }),
    ).toEqual(["groq"]);
  });

  it("returns nothing when everything is avoided or unconfigured", () => {
    expect(
      buildLadder({ tier: "fast", configured: () => false, cooling: () => false }),
    ).toEqual([]);
  });
});

describe("provider cooldown memory", () => {
  it("classifies only the failures that repeat", () => {
    expect(classifyProviderFailure(401, "unauthorized")).toBe("auth");
    expect(classifyProviderFailure(undefined, "GROQ_API_KEY is not set")).toBe("auth");
    expect(classifyProviderFailure(429, "failed (429) — daily quota used up")).toBe("daily");
    expect(classifyProviderFailure(429, "failed (429) — per-minute rate limit")).toBe("throttle");
    // A 404/500 says nothing about the next call: no cooldown.
    expect(classifyProviderFailure(404, "model not found")).toBeNull();
    expect(classifyProviderFailure(500, "down")).toBeNull();
  });

  it("stops asking a provider that is out of daily quota, then asks again after a success", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: groq 401 (auth → cooldown), gemini answers
      .mockResolvedValueOnce(jsonResponse({ error: "bad key" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: "a" }] } }] }),
      )
      // 2nd call: groq is cooling, so gemini is asked FIRST
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: "b" }] } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await routeAI({ kind: "chat", prompt: "x" });
    expect(providerHealth.isCooling("groq")).toBe(true);

    await routeAI({ kind: "chat", prompt: "y" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });

  it("a success clears that provider cooldown", async () => {
    providerHealth.markFailure("groq", 401, "unauthorized");
    expect(providerHealth.isCooling("groq")).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          jsonResponse({ choices: [{ message: { content: "ok" } }] }),
        ),
    );
    // Pinned so the cooling provider itself is the one that answers.
    await routeAI({ kind: "chat", prompt: "x", pin: "groq" });
    expect(providerHealth.isCooling("groq")).toBe(false);
  });
});

describe("prefer + avoid (debate independence)", () => {
  it("prefer picks the first rung but still falls back", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() =>
      // Every Gemini candidate is out of quota; Groq is behind them.
      ++call <= GEMINI_CANDIDATES
        ? jsonResponse({ error: "quota" }, 429)
        : jsonResponse({ choices: [{ message: { content: "groq caught it" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await routeChatWithProvenance({
      kind: "chat",
      prompt: "x",
      prefer: "gemini",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("googleapis.com");
    expect(reply.provider).toBe("groq");
    expect(reply.text).toBe("groq caught it");
  });

  it("avoid keeps a provider out of the ladder entirely", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "g" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await routeChatWithProvenance({
      kind: "chat",
      prompt: "x",
      avoid: ["groq"],
    });
    expect(reply.provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports honestly when no provider is left after avoid", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
    const error = await routeChatWithProvenance({
      kind: "chat",
      prompt: "x",
      avoid: ["groq"],
    }).catch((e) => e);
    expect(error).toBeInstanceOf(AIRouterError);
    expect(error.message).toContain("no AI provider is configured");
  });
});

describe("routeAI embed", () => {
  it("routes embeddings to Gemini batchEmbedContents", async () => {
    // Real size: the router now refuses any vector that is not the 768 the
    // pgvector columns hold (a 2-dim fixture used to slip through).
    const a = Array.from({ length: 768 }, () => 0.1);
    const b = Array.from({ length: 768 }, () => 0.3);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ embeddings: [{ values: a }, { values: b }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "embed", texts: ["a", "b"] })).resolves.toEqual([a, b]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("batchEmbedContents");
  });
});

describe("routeAI quality tier (degradation ladder)", () => {
  beforeEach(() => {
    bedrockCreate.mockReset();
    // No AWS creds by default — Bedrock is skipped entirely
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
  });

  it("without AWS creds, quality routes to the Gemini quality model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "pro answer" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      routeAI({ kind: "chat", tier: "quality", prompt: "x" }),
    ).resolves.toBe("pro answer");
    expect(bedrockCreate).not.toHaveBeenCalled();
    // Live-verified head of the candidate list on this account (2026-09-21).
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-2.5-flash");
  });

  it("says a Gemini 429 is a DAILY quota, so nobody retries in vain (and never echoes the key)", async () => {
    const body = { error: { message: "Quota exceeded", details: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] } };
    vi.stubEnv("GEMINI_CHAT_MODEL", "only-one");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse(body, 429)));
    const err = await routeAI({ kind: "chat", pin: "gemini", prompt: "x" }).catch((e) => e);
    expect(err.message).toBe("Gemini request failed (429) — daily quota used up");
    expect(err.status).toBe(429);
  });

  it("distinguishes a per-minute rate limit from a daily one, and an unknown 429", async () => {
    const perMinute = { error: { details: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] } };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse(perMinute, 429)));
    expect((await routeAI({ kind: "chat", pin: "gemini", prompt: "x" }).catch((e) => e)).message).toContain("per-minute rate limit");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse({ error: "slow down" }, 429)));
    expect((await routeAI({ kind: "chat", pin: "gemini", prompt: "x" }).catch((e) => e)).message).toContain("quota or rate limit");
  });

  it("adds no hint to other Gemini failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse({ error: "down" }, 503)));
    expect((await routeAI({ kind: "chat", pin: "gemini", prompt: "x" }).catch((e) => e)).message).toBe("Gemini request failed (503)");
  });

  it("GEMINI_QUALITY_MODEL still overrides the quality model (e.g. back to Pro)", async () => {
    vi.stubEnv("GEMINI_QUALITY_MODEL", "gemini-3.1-pro-preview");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "pro" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await routeAI({ kind: "chat", tier: "quality", prompt: "x" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-3.1-pro-preview");
    vi.unstubAllEnvs();
  });

  it("falls through to Groq when the Gemini quality model fails", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() =>
      ++call <= GEMINI_CANDIDATES
        ? jsonResponse({ error: "down" }, 500)
        : jsonResponse({ choices: [{ message: { content: "groq saves" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      routeAI({ kind: "chat", tier: "quality", prompt: "x" }),
    ).resolves.toBe("groq saves");
    expect(String(fetchMock.mock.calls[GEMINI_CANDIDATES][0])).toContain("api.groq.com");
  });

  it("with AWS creds, quality goes to Bedrock and skips HTTP providers", async () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    bedrockCreate.mockResolvedValue({
      content: [{ type: "text", text: "claude via bedrock" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      routeAI({ kind: "chat", tier: "quality", prompt: "x" }),
    ).resolves.toBe("claude via bedrock");
    expect(bedrockCreate.mock.calls[0][0].model).toBe(
      "anthropic.claude-opus-4-8",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls from Bedrock to Gemini when Bedrock errors", async () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    bedrockCreate.mockRejectedValue(new Error("model not available in region"));
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "gemini rescue" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      routeAI({ kind: "chat", tier: "quality", prompt: "x" }),
    ).resolves.toBe("gemini rescue");
  });
});

describe("pinned provider", () => {
  it("calls Gemini directly when pin=gemini, skipping Groq", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "pinned" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      routeAI({ kind: "chat", prompt: "x", pin: "gemini" }),
    ).resolves.toBe("pinned");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });
});

describe("configuration errors", () => {
  it("throws AIRouterError when the provider key is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
    await expect(routeAI({ kind: "chat", prompt: "x" })).rejects.toBeInstanceOf(
      AIRouterError,
    );
  });
});

describe("Gemini model candidates (a dead model id is not an outage)", () => {
  it("moves to the next model when the configured one cannot be served", async () => {
    // Live failure mode, 2026-09-21: gemini-3.6-flash is not on this key's
    // model list and Google answers 429, which reads exactly like a quota.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 429 } }, 429))
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: "2.5 answered" }] } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await routeChatWithProvenance({
      kind: "chat",
      pin: "gemini",
      prompt: "x",
    });
    expect(reply.text).toBe("2.5 answered");
    // The head of the list answered 429; the next candidate carried the call.
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-2.5-flash");
    expect(reply.model).toBe("gemini-flash-latest");
  });

  it("tries an explicit GEMINI_CHAT_MODEL first, then the verified fallbacks", async () => {
    vi.stubEnv("GEMINI_CHAT_MODEL", "gemini-experimental");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "gone" }, 404))
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: "fallback" }] } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await routeChatWithProvenance({ kind: "chat", pin: "gemini", prompt: "x" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-experimental");
    expect(reply.model).toBe("gemini-2.5-flash");
    vi.unstubAllEnvs();
  });

  it("only moves to another provider once every Gemini model has failed", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() =>
      ++call <= GEMINI_CANDIDATES
        ? jsonResponse({ error: "no" }, 404)
        : jsonResponse({ choices: [{ message: { content: "groq caught it" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await routeChatWithProvenance({
      kind: "chat",
      tier: "quality",
      prompt: "x",
    });
    expect(reply.provider).toBe("groq");
    // Every Gemini candidate was tried before the ladder moved on.
    expect(fetchMock).toHaveBeenCalledTimes(GEMINI_CANDIDATES + 1);
  });
});
