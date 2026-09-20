import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AIRouterError, routeAI } from "./router";
import { logAiUsage } from "./budget";

vi.mock("./budget", () => ({
  enforceAiBudget: vi.fn().mockResolvedValue(undefined),
  logAiUsage: vi.fn(),
}));
vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  AnthropicBedrockMantle: class {
    messages = { create: vi.fn() };
  },
}));

const logMock = logAiUsage as unknown as Mock;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }],
};

beforeEach(() => {
  logMock.mockClear();
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  vi.stubEnv("AWS_REGION", "");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("router observability", () => {
  it("records latency on a successful call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: "ok" } }] }),
      ),
    );

    await routeAI({ kind: "chat", prompt: "hello" });

    expect(logMock).toHaveBeenCalledTimes(1);
    const event = logMock.mock.calls[0][0];
    expect(event.provider).toBe("groq");
    expect(event.status).toBeUndefined();
    expect(typeof event.latencyMs).toBe("number");
  });

  it("a fallback success no longer hides the primary failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "limited" }, 429))
        .mockResolvedValueOnce(jsonResponse(GEMINI_OK)),
    );

    await expect(routeAI({ kind: "chat", prompt: "hello" })).resolves.toBe(
      "gemini says hi",
    );

    expect(logMock).toHaveBeenCalledTimes(2);
    const [failed, ok] = logMock.mock.calls.map((c) => c[0]);
    expect(failed).toMatchObject({
      provider: "groq",
      status: "failed",
      tokensIn: 0,
      tokensOut: 0,
    });
    expect(failed.error).toContain("429");
    expect(typeof failed.latencyMs).toBe("number");
    expect(ok).toMatchObject({ provider: "gemini" });
    expect(ok.status).toBeUndefined();
  });

  it("quality ladder logs every silent fall-through", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "down" }, 500))
        .mockResolvedValueOnce(
          jsonResponse({ choices: [{ message: { content: "groq saves" } }] }),
        ),
    );

    await routeAI({ kind: "chat", tier: "quality", prompt: "x" });

    const events = logMock.mock.calls.map((c) => c[0]);
    expect(events.map((e) => [e.provider, e.status ?? "ok"])).toEqual([
      ["gemini", "failed"],
      ["groq", "ok"],
    ]);
  });

  it("a total failure still leaves a failed row and rethrows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, 400)),
    );

    await expect(routeAI({ kind: "chat", prompt: "x" })).rejects.toBeInstanceOf(
      AIRouterError,
    );

    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({
      provider: "groq",
      status: "failed",
    });
  });

  it("logs a failed embed attempt with latency", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "x" }, 500)),
    );

    await expect(
      routeAI({ kind: "embed", texts: ["a"] }),
    ).rejects.toBeInstanceOf(AIRouterError);

    expect(logMock.mock.calls[0][0]).toMatchObject({
      provider: "gemini",
      kind: "embed",
      status: "failed",
    });
    expect(typeof logMock.mock.calls[0][0].latencyMs).toBe("number");
  });

  it("never persists an API key from a provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error(
            "request to https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=SECRET123&alt=json failed",
          ),
        ),
    );

    await expect(
      routeAI({ kind: "chat", prompt: "x", pin: "gemini" }),
    ).rejects.toThrow();

    const event = logMock.mock.calls[0][0];
    expect(event.error).not.toContain("SECRET123");
    expect(event.error).toContain("key=[redacted]");
  });
});
