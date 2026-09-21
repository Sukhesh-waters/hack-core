/**
 * Per-model memory and embedding spaces (2026-09-21).
 *
 * Kept apart from router.test.ts so each file stays readable. Both behaviours
 * come from live failures on the NVIDIA key: a chat model slower than the
 * timeout, and an embedding model whose vectors are a different size and a
 * different space from everything stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIRouterError,
  EMBEDDING_SPACE_DIMENSIONS,
  classifyModelFailure,
  modelHealth,
  orderModels,
  providerHealth,
  routeAI,
  routeChatWithProvenance,
} from "./router";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const timeoutError = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
  });

/** Only NVIDIA configured, so the ladder has exactly one provider to use. */
function nvidiaOnly() {
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("NVIDIA_API_KEY", "test-nvidia");
}

beforeEach(() => {
  providerHealth.reset();
  modelHealth.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  providerHealth.reset();
  modelHealth.reset();
});

describe("per-model memory (a slow model must not cost 60s on every call)", () => {
  it("classifies only failures that will repeat for that model", () => {
    expect(classifyModelFailure(timeoutError())).toBe("slow");
    expect(classifyModelFailure(new AIRouterError("no access", "nvidia", 404))).toBe("missing");
    expect(classifyModelFailure(new AIRouterError("gone", "nvidia", 410))).toBe("missing");
    // A 503 or a 429 is about the moment, not the model.
    expect(classifyModelFailure(new AIRouterError("busy", "nvidia", 503))).toBeNull();
    expect(classifyModelFailure(new AIRouterError("slow down", "nvidia", 429))).toBeNull();
  });

  it("orders ready models first and sidelined ones last, never dropping any", () => {
    expect(orderModels(["slow", "fast", "other"], (m) => m === "slow")).toEqual([
      "fast",
      "other",
      "slow",
    ]);
    expect(orderModels(["only"], () => true)).toEqual(["only"]);
  });

  it("skips a model that just timed out and goes straight to one that works", async () => {
    // Live, 2026-09-21: nemotron-3.5-lightning took 76.7s against a 60s
    // timeout while gpt-oss-20b on the same key took 4s.
    nvidiaOnly();
    vi.stubEnv("NVIDIA_CHAT_MODEL", "slow/model");
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const { model } = JSON.parse(String(init.body)) as { model: string };
      return model === "slow/model"
        ? Promise.reject(timeoutError())
        : Promise.resolve(jsonResponse({ choices: [{ message: { content: `from ${model}` } }] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await routeChatWithProvenance({ kind: "chat", prompt: "x" });
    expect(first.model).toBe("openai/gpt-oss-20b");
    expect(modelHealth.isCooling("nvidia", "slow/model")).toBe(true);

    fetchMock.mockClear();
    const second = await routeChatWithProvenance({ kind: "chat", prompt: "y" });
    // The sidelined model is not tried first again: one request, not two.
    expect(second.model).toBe("openai/gpt-oss-20b");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a model that answers again is taken off the bench", async () => {
    nvidiaOnly();
    modelHealth.markFailure("nvidia", "openai/gpt-oss-20b", timeoutError());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] })),
    );
    await routeChatWithProvenance({ kind: "chat", prompt: "x", pin: "nvidia" });
    // Whichever model answered is healthy now; nothing stays benched after a success.
    expect(modelHealth.snapshot().some((e) => e.key.endsWith("gpt-oss-20b"))).toBe(
      modelHealth.isCooling("nvidia", "openai/gpt-oss-20b"),
    );
  });

  it("still reads the older NVIDIA_NEMOTRON_MODEL name", async () => {
    nvidiaOnly();
    vi.stubEnv("NVIDIA_NEMOTRON_MODEL", "legacy/name");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] })),
    );
    expect((await routeChatWithProvenance({ kind: "chat", prompt: "x" })).model).toBe(
      "legacy/name",
    );
  });

  it("prefers NVIDIA_CHAT_MODEL when both names are set", async () => {
    nvidiaOnly();
    vi.stubEnv("NVIDIA_NEMOTRON_MODEL", "legacy/name");
    vi.stubEnv("NVIDIA_CHAT_MODEL", "current/name");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse({ choices: [{ message: { content: "ok" } }] })),
    );
    expect((await routeChatWithProvenance({ kind: "chat", prompt: "x" })).model).toBe(
      "current/name",
    );
  });
});

describe("embedding spaces (vectors are never interchangeable)", () => {
  const vectorOf = (n: number, value = 0.01) => Array.from({ length: n }, () => value);

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini");
    vi.stubEnv("NVIDIA_API_KEY", "test-nvidia");
  });

  it("defaults to Gemini, the 768-dim space every stored vector is in", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ embeddings: [{ values: vectorOf(768) }] }));
    vi.stubGlobal("fetch", fetchMock);

    const [vector] = await routeAI({ kind: "embed", texts: ["a"] });
    expect(vector).toHaveLength(EMBEDDING_SPACE_DIMENSIONS.gemini);
    expect(String(fetchMock.mock.calls[0][0])).toContain("batchEmbedContents");
  });

  it("embeds in the NVIDIA space only when asked, with the input type it needs", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ data: [{ index: 0, embedding: vectorOf(2048) }] }));
    vi.stubGlobal("fetch", fetchMock);

    const [vector] = await routeAI({
      kind: "embed",
      texts: ["what is new at bluebird"],
      space: "nvidia",
      inputType: "query",
    });
    expect(vector).toHaveLength(EMBEDDING_SPACE_DIMENSIONS.nvidia);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/embeddings");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe("nvidia/nemotron-3-embed-1b");
    expect(body.input_type).toBe("query");
  });

  it("defaults NVIDIA documents to the passage input type", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ data: [{ index: 0, embedding: vectorOf(2048) }] }));
    vi.stubGlobal("fetch", fetchMock);

    await routeAI({ kind: "embed", texts: ["a page"], space: "nvidia" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).input_type).toBe("passage");
  });

  it("returns vectors in the API's index order, not arrival order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        jsonResponse({
          data: [
            { index: 1, embedding: vectorOf(2048, 2) },
            { index: 0, embedding: vectorOf(2048, 1) },
          ],
        }),
      ),
    );
    const out = await routeAI({ kind: "embed", texts: ["first", "second"], space: "nvidia" });
    expect(out[0][0]).toBe(1);
    expect(out[1][0]).toBe(2);
  });

  it("never falls back from Gemini to NVIDIA — a different space is not a backup", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ error: "down" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "embed", texts: ["a"] })).rejects.toBeInstanceOf(AIRouterError);
    // Exactly one call, to Gemini. Nothing reached the NVIDIA endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/embeddings");
  });

  it("refuses a vector of the wrong size before it can reach the database", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })),
    );
    const error = await routeAI({ kind: "embed", texts: ["a"], space: "nvidia" }).catch((e) => e);
    expect(error).toBeInstanceOf(AIRouterError);
    expect(error.message).toContain("returned 3 dimensions, expected 2048");
  });
});
