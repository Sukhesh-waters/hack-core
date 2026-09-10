import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIRouterError, routeAI } from "./router";

const bedrockCreate = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  AnthropicBedrockMantle: class {
    messages = { create: bedrockCreate };
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

  it("does not fall back on non-throttle client errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "bad request" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "x" })).rejects.toBeInstanceOf(
      AIRouterError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("routeAI embed", () => {
  it("routes embeddings to Gemini batchEmbedContents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      routeAI({ kind: "embed", texts: ["a", "b"] }),
    ).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
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
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-2.5-pro");
  });

  it("falls through to Groq when the Gemini quality model fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, 500))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: "groq saves" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      routeAI({ kind: "chat", tier: "quality", prompt: "x" }),
    ).resolves.toBe("groq saves");
    expect(String(fetchMock.mock.calls[1][0])).toContain("api.groq.com");
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

describe("configuration errors", () => {
  it("throws AIRouterError when the provider key is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
    await expect(routeAI({ kind: "chat", prompt: "x" })).rejects.toBeInstanceOf(
      AIRouterError,
    );
  });
});
