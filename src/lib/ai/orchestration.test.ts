/**
 * Multi-model orchestration (2026-09-21): who goes first, when a provider is
 * too full to ask, and when a reply is not the answer. The pure policy is
 * tested here; the router wiring is tested at the bottom through routeAI with
 * a mocked fetch, the same way router.test.ts does it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LADDERS,
  containsJson,
  derailment,
  parseResetDuration,
  providerCapacity,
  resolveWorkload,
  runAsWorkload,
} from "./orchestration";
import {
  buildLadder,
  modelHealth,
  providerHealth,
  routeAI,
  routeChatWithProvenance,
} from "./router";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const groqReply = (content: string, headers: Record<string, string> = {}) =>
  jsonResponse({ choices: [{ message: { content } }] }, 200, headers);
const geminiReply = (text: string) =>
  jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });

/** Which provider a mocked fetch call went to. */
const providerOf = (url: string) =>
  url.includes("groq.com") ? "groq" : url.includes("nvidia.com") ? "nvidia" : "gemini";

function allThreeConfigured() {
  vi.stubEnv("GROQ_API_KEY", "test-groq");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini");
  vi.stubEnv("NVIDIA_API_KEY", "test-nvidia");
}

beforeEach(() => {
  providerHealth.reset();
  modelHealth.reset();
  providerCapacity.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  providerHealth.reset();
  modelHealth.reset();
  providerCapacity.reset();
});

describe("ladders", () => {
  it("every ladder holds every provider — policy changes order, never membership", () => {
    for (const tier of Object.values(LADDERS)) {
      for (const ladder of Object.values(tier)) {
        expect([...ladder].sort()).toEqual(["bedrock", "gemini", "groq", "nvidia"]);
      }
    }
  });

  it("a person waiting gets the fastest provider; a job gets NVIDIA and leaves Groq alone", () => {
    const all = () => true;
    const calm = () => false;
    expect(buildLadder({ tier: "fast", workload: "interactive", configured: all, cooling: calm })[0]).toBe("groq");
    const background = buildLadder({ tier: "fast", workload: "background", configured: all, cooling: calm });
    expect(background[0]).toBe("nvidia");
    // Groq is still there for a job when the others fail — just not first.
    expect(background).toContain("groq");
  });

  it("the quality tier puts the strongest model first (120b ahead of 20b)", () => {
    const noBedrock = (p: string) => p !== "bedrock";
    const calm = () => false;
    expect(buildLadder({ tier: "quality", workload: "interactive", configured: noBedrock, cooling: calm }))
      .toEqual(["gemini", "groq", "nvidia"]);
    expect(buildLadder({ tier: "quality", workload: "background", configured: noBedrock, cooling: calm }))
      .toEqual(["gemini", "nvidia", "groq"]);
  });

  it("a saturated provider goes behind the ready ones but ahead of a resting one", () => {
    expect(
      buildLadder({
        tier: "fast",
        workload: "interactive",
        configured: () => true,
        cooling: (p) => p === "gemini",
        affordable: (p) => p !== "groq",
      }),
    ).toEqual(["nvidia", "bedrock", "groq", "gemini"]);
  });
});

describe("workload context", () => {
  it("defaults to interactive, and an explicit setting beats the context", () => {
    expect(resolveWorkload()).toBe("interactive");
    runAsWorkload("background", () => {
      expect(resolveWorkload()).toBe("background");
      expect(resolveWorkload("interactive")).toBe("interactive");
    });
  });

  it("survives awaits — an Inngest step is many ticks deep", async () => {
    const seen = await runAsWorkload("background", async () => {
      await new Promise((r) => setTimeout(r, 1));
      await Promise.resolve();
      return resolveWorkload();
    });
    expect(seen).toBe("background");
    expect(resolveWorkload()).toBe("interactive");
  });
});

describe("capacity from rate-limit headers", () => {
  it("parses Groq's reset durations", () => {
    expect(parseResetDuration("577ms")).toBe(577);
    expect(parseResetDuration("7.66s")).toBe(7660);
    expect(parseResetDuration("1m26.4s")).toBe(86_400);
    expect(parseResetDuration("2h3m")).toBe(7_380_000);
    expect(parseResetDuration("")).toBeNull();
    expect(parseResetDuration("soon")).toBeNull();
  });

  const groqHeaders = (tokensLeft: number, requestsLeft = 900) =>
    new Headers({
      "x-ratelimit-limit-tokens": "8000",
      "x-ratelimit-remaining-tokens": String(tokensLeft),
      "x-ratelimit-reset-tokens": "30s",
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-remaining-requests": String(requestsLeft),
      "x-ratelimit-reset-requests": "2h",
    });

  it("is optimistic about a provider that has never sent headers", () => {
    expect(providerCapacity.canAfford("nvidia", 50_000)).toBe(true);
    providerCapacity.observe("nvidia", new Headers());
    expect(providerCapacity.canAfford("nvidia", 50_000)).toBe(true);
  });

  it("refuses a call the current window cannot hold, until the window resets", () => {
    const now = 1_000_000;
    providerCapacity.observe("groq", groqHeaders(1_500), now);
    expect(providerCapacity.canAfford("groq", 1_000, now)).toBe(true);
    expect(providerCapacity.canAfford("groq", 3_000, now)).toBe(false);
    // 30s later the minute has rolled over.
    expect(providerCapacity.canAfford("groq", 3_000, now + 31_000)).toBe(true);
  });

  it("refuses a call bigger than the whole per-minute limit — it could never succeed", () => {
    const now = 1_000_000;
    providerCapacity.observe("groq", groqHeaders(8_000), now);
    expect(providerCapacity.canAfford("groq", 9_000, now + 10 * 60_000)).toBe(false);
  });

  it("refuses everything once the daily request allowance is gone", () => {
    const now = 1_000_000;
    providerCapacity.observe("groq", groqHeaders(8_000, 0), now);
    expect(providerCapacity.canAfford("groq", 10, now)).toBe(false);
    expect(providerCapacity.canAfford("groq", 10, now + 3 * 3_600_000)).toBe(true);
  });

  it("ignores a response object without headers (test doubles, odd SDKs)", () => {
    providerCapacity.observe("groq", undefined);
    expect(providerCapacity.snapshot()).toEqual([]);
  });
});

describe("derailment", () => {
  it("accepts JSON bare, fenced, or wrapped in reasoning prose", () => {
    expect(containsJson('{"a":1}')).toBe(true);
    expect(containsJson('```json\n{"a":1}\n```')).toBe(true);
    expect(containsJson('Let me think... the answer is {"a":"x}"} as asked.')).toBe(true);
    expect(containsJson("[1,2]")).toBe(true);
  });

  it("rejects prose, a broken object, and nothing at all", () => {
    expect(containsJson("The claim is that prices rose.")).toBe(false);
    expect(containsJson('{"a": 1')).toBe(false);
    expect(containsJson("   ")).toBe(false);
  });

  it("names the reason, and only checks JSON when JSON was asked for", () => {
    expect(derailment("", false)).toBe("empty reply");
    expect(derailment("plain prose", false)).toBeNull();
    expect(derailment("plain prose", true)).toBe("prose instead of JSON");
    expect(derailment('{"ok":true}', true)).toBeNull();
  });
});

describe("router wiring", () => {
  it("a JSON call answered in prose moves on to the next provider", async () => {
    allThreeConfigured();
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      providerOf(url) === "groq"
        ? groqReply("Sure! The claim is that prices rose.")
        : geminiReply('{"claim":"prices rose"}'),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await routeChatWithProvenance({ kind: "chat", json: true, prompt: "x" });
    expect(reply.provider).toBe("gemini");
    expect(JSON.parse(reply.text)).toEqual({ claim: "prices rose" });
    // Prose is not a health problem: Groq is not benched for it.
    expect(providerHealth.isCooling("groq")).toBe(false);
  });

  it("when every provider answers prose, the first prose reply is still returned (never worse than before)", async () => {
    allThreeConfigured();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        providerOf(url) === "gemini" ? geminiReply("gemini prose") : groqReply(`${providerOf(url)} prose`),
      ),
    );
    const reply = await routeChatWithProvenance({ kind: "chat", json: true, prompt: "x" });
    expect(reply.provider).toBe("groq");
    expect(reply.text).toBe("groq prose");
  });

  it("an empty reply is never an answer, JSON or not", async () => {
    allThreeConfigured();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        providerOf(url) === "groq" ? groqReply("   ") : geminiReply("a real answer"),
      ),
    );
    expect(await routeAI({ kind: "chat", prompt: "x" })).toBe("a real answer");
  });

  it("inside an Inngest job the first request goes to NVIDIA, not Groq", async () => {
    allThreeConfigured();
    const fetchMock = vi.fn().mockImplementation(() => groqReply("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await runAsWorkload("background", () =>
      routeChatWithProvenance({ kind: "chat", prompt: "x" }),
    );
    expect(reply.provider).toBe("nvidia");
    expect(providerOf(fetchMock.mock.calls[0][0])).toBe("nvidia");
  });

  it("once Groq says its minute is spent, the next interactive call skips it — no 429 round trip", async () => {
    allThreeConfigured();
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      providerOf(url) === "groq"
        ? groqReply("from groq", {
            "x-ratelimit-limit-tokens": "8000",
            "x-ratelimit-remaining-tokens": "40",
            "x-ratelimit-reset-tokens": "45s",
          })
        : geminiReply("from gemini"),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect((await routeChatWithProvenance({ kind: "chat", prompt: "first" })).provider).toBe("groq");
    fetchMock.mockClear();
    const second = await routeChatWithProvenance({ kind: "chat", prompt: "second" });
    expect(second.provider).toBe("gemini");
    expect(fetchMock.mock.calls.every(([url]) => providerOf(url) !== "groq")).toBe(true);
  });
});
