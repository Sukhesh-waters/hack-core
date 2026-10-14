import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  AIRouterError,
  routeChatWithProvenance,
  type ProviderId,
} from "@/lib/ai/router";
import { BLIND_CHALLENGER_SYSTEM } from "./challenger";
import {
  CHALLENGER_SYSTEM,
  downgradeIfNotIndependent,
  runContradictionRound,
  runInterrogationRound,
  SAME_PROVIDER_CAVEAT,
} from "./debate";

vi.mock("@/lib/ai/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/router")>();
  return { ...actual, routeChatWithProvenance: vi.fn() };
});
const routeMock = routeChatWithProvenance as unknown as Mock;

const claim = JSON.stringify({
  text: "Rivals push guarantees",
  evidenceSpans: ["guarantee"],
  specificity: 0.9,
});
const weakAttack = JSON.stringify({
  text: "Nothing contradicts this",
  confounders: [],
  strongestObjection: "none",
  confounderStrength: 0,
});

const reply = (text: string, provider: ProviderId) => ({
  text,
  provider,
  model: `${provider}-model`,
  latencyMs: 1,
});

type Routing = { avoid?: ProviderId[]; prefer?: ProviderId };

beforeEach(() => {
  routeMock.mockReset();
});

/**
 * The proposer always answers on Groq. `challenger` decides what the second
 * call does, given the routing it was asked for.
 */
function stub(challenger: (routing: Routing) => Promise<{ text: string; provider: ProviderId }>) {
  let first = true;
  routeMock.mockImplementation(async (task: Routing) => {
    if (first) {
      first = false;
      return reply(claim, "groq");
    }
    const out = await challenger(task);
    return reply(out.text, out.provider);
  });
}

describe("runContradictionRound — independence measured by who answered", () => {
  it("uses an independent challenger when one is available", async () => {
    stub(async () => ({ text: weakAttack, provider: "gemini" }));
    const out = await runContradictionRound("signal text");

    expect(out.independent).toBe(true);
    expect(out.providers).toEqual({ proposer: "groq", challenger: "gemini" });
    expect(out.result.state).toBe("agreed");
    expect(out.result.caveat ?? "").not.toContain(SAME_PROVIDER_CAVEAT);
  });

  it("returns the model each side actually answered with, alongside the provider (B0 provenance)", async () => {
    stub(async () => ({ text: weakAttack, provider: "gemini" }));
    const out = await runContradictionRound("signal text");

    expect(out.models).toEqual({ proposer: "groq-model", challenger: "gemini-model" });
  });

  it("objected is false for an honest no-material-objection reply, true for a real one", async () => {
    stub(async () => ({ text: weakAttack, provider: "gemini" }));
    const noObjection = await runContradictionRound("signal text");
    expect(noObjection.objected).toBe(false);

    const realObjection = JSON.stringify({
      text: "the sample is from one region",
      confounders: ["seasonality"],
      strongestObjection: "single-region sample",
      confounderStrength: 0.6,
    });
    stub(async () => ({ text: realObjection, provider: "gemini" }));
    const objected = await runContradictionRound("signal text");
    expect(objected.objected).toBe(true);
  });

  it("asks the challenger to avoid the provider that proposed", async () => {
    stub(async () => ({ text: weakAttack, provider: "gemini" }));
    await runContradictionRound("signal text");

    // No provider preference: the workload ladder picks the proposer, so a
    // background job does not spend Groq's per-minute budget.
    expect(routeMock.mock.calls[0][0]).not.toHaveProperty("prefer");
    expect(routeMock.mock.calls[0][0]).not.toHaveProperty("pin");
    expect(routeMock.mock.calls[1][0]).toMatchObject({ avoid: ["groq"] });
  });

  it("falls back to the proposer's provider when no independent one can answer", async () => {
    stub(async (routing) => {
      if (routing.avoid) {
        throw new AIRouterError(
          "every AI provider failed: gemini (429) — daily quota used up",
          "gemini",
          429,
        );
      }
      return { text: weakAttack, provider: "groq" };
    });
    const out = await runContradictionRound("signal text");

    expect(out.independent).toBe(false);
    expect(out.providers).toEqual({ proposer: "groq", challenger: "groq" });
    expect(routeMock).toHaveBeenCalledTimes(3);
  });

  it("a non-independent round can never read 'agreed'", async () => {
    stub(async (routing) => {
      if (routing.avoid) throw new AIRouterError("down", "gemini", 503);
      return { text: weakAttack, provider: "groq" };
    });
    const out = await runContradictionRound("signal text");

    expect(out.result.state).toBe("qualified");
    expect(out.result.caveat).toContain(SAME_PROVIDER_CAVEAT);
  });

  it("stays independent when the fallback attempt is answered by a third provider", async () => {
    // prefer is a preference, not a pin: if the ladder hands the reply to a
    // different provider, the round really is independent and says so.
    stub(async (routing) => {
      if (routing.avoid) throw new AIRouterError("no rung left", "gemini", 429);
      return { text: weakAttack, provider: "bedrock" };
    });
    const out = await runContradictionRound("signal text");

    expect(out.independent).toBe(true);
    expect(out.result.caveat ?? "").not.toContain(SAME_PROVIDER_CAVEAT);
  });

  it("does not swallow a proposer failure or a non-router error", async () => {
    routeMock.mockRejectedValueOnce(
      new AIRouterError("every AI provider failed: groq (500)", "groq", 500),
    );
    await expect(runContradictionRound("s")).rejects.toThrow("every AI provider failed");

    routeMock.mockReset();
    routeMock
      .mockResolvedValueOnce(reply(claim, "groq"))
      .mockRejectedValueOnce(new TypeError("bug, not a provider failure"));
    await expect(runContradictionRound("s")).rejects.toThrow(TypeError);
  });

  it("only one fallback attempt: if that fails too, the round fails", async () => {
    stub(async () => {
      throw new AIRouterError("every AI provider failed: groq (500)", "groq", 500);
    });
    await expect(runContradictionRound("s")).rejects.toThrow(/every AI provider failed/);
    expect(routeMock).toHaveBeenCalledTimes(3);
  });
});

describe("downgradeIfNotIndependent", () => {
  it("leaves an independent result untouched", () => {
    const r = { state: "agreed" as const, score: 0.9 };
    expect(downgradeIfNotIndependent(r, true)).toBe(r);
  });

  it("qualifies an agreed result, and keeps an existing caveat", () => {
    expect(
      downgradeIfNotIndependent({ state: "agreed", score: 0.9, caveat: "thin data" }, false),
    ).toEqual({
      state: "qualified",
      score: 0.9,
      caveat: `thin data ${SAME_PROVIDER_CAVEAT}`,
    });
  });

  it("does not soften a contested or refuted result, only annotates it", () => {
    for (const state of ["contested", "refuted"] as const) {
      const out = downgradeIfNotIndependent({ state, score: 0.2 }, false);
      expect(out.state).toBe(state);
      expect(out.caveat).toBe(SAME_PROVIDER_CAVEAT);
    }
  });
});

describe("runInterrogationRound — B2 challenger mode", () => {
  const spans = {
    e1: "Rivals push 48-hour guarantees across the category.",
    e2: "Three competitors added this claim in the last month.",
  };
  const numbered = {
    input:
      "Competitor: Rivals\n" +
      "Source: a page on the competitor's own website — https://rival.example/news\n\n" +
      `WHAT CHANGED — this is the signal:\n[e1] ${spans.e1}\n[e2] ${spans.e2}`,
    spans,
  };
  const validReply = JSON.stringify({
    headline: "Rivals push 48-hour guarantees",
    what: "Three competitors now offer a 48-hour guarantee.",
    why: ["e1", "e2"],
    how: "A wave of matching guarantees signals a category-wide response.",
    kind: "claim",
    falsifier: { metric: "topic_momentum", subject: { topic: "48h guarantee" }, direction: "below", threshold: 1.0, window_days: 30 },
    confidence: "medium",
  });
  const noObjectionReply = (withVerdict: boolean) =>
    JSON.stringify({
      text: "Nothing contradicts this.",
      confounders: [],
      strongestObjection: "none",
      confounderStrength: 0,
      ...(withVerdict ? { verdict: "no_material_objection" } : {}),
    });

  it("mode 'off' (challengerOpts omitted): blinded is false, and the challenger sees today's full prompt (signal + raw proposer JSON)", async () => {
    routeMock.mockReset();
    routeMock
      .mockResolvedValueOnce(reply(validReply, "groq"))
      .mockResolvedValueOnce(reply(noObjectionReply(false), "gemini"));

    const out = await runInterrogationRound(numbered);

    expect(out.blinded).toBe(false);
    expect(routeMock.mock.calls[1][0]).toMatchObject({ system: CHALLENGER_SYSTEM });
    expect((routeMock.mock.calls[1][0] as { prompt: string }).prompt).toContain("rival.example");
  });

  it("mode 'on': blinded is always true, and the challenger never sees the signal text or raw proposer JSON", async () => {
    routeMock.mockReset();
    routeMock
      .mockResolvedValueOnce(reply(validReply, "groq"))
      .mockResolvedValueOnce(reply(noObjectionReply(true), "gemini"));

    const out = await runInterrogationRound(numbered, undefined, undefined, { signalId: "sig-x", mode: "on" });

    expect(out.blinded).toBe(true);
    expect(routeMock.mock.calls[1][0]).toMatchObject({ system: BLIND_CHALLENGER_SYSTEM });
    const prompt = (routeMock.mock.calls[1][0] as { prompt: string }).prompt;
    expect(prompt).not.toContain("rival.example");
    expect(prompt.toLowerCase()).not.toContain("groq");
  });

  it("mode 'shadow': which arm a signal lands in is a deterministic function of its id — stable across repeated calls", async () => {
    const runOnce = async (signalId: string) => {
      routeMock.mockReset();
      routeMock
        .mockResolvedValueOnce(reply(validReply, "groq"))
        .mockResolvedValueOnce(reply(noObjectionReply(true), "gemini"));
      return runInterrogationRound(numbered, undefined, undefined, { signalId, mode: "shadow" });
    };
    const first = await runOnce("sig-stable");
    const second = await runOnce("sig-stable");
    expect(first.blinded).toBe(second.blinded);
  });

  it("a proposer reply that fails to parse still blinds safely: the fallback basis has no evidence and leaks no signal text or provider id", async () => {
    routeMock.mockReset();
    routeMock
      .mockResolvedValueOnce(reply("not json at all", "groq"))
      .mockResolvedValueOnce(reply(noObjectionReply(true), "gemini"));

    const out = await runInterrogationRound(numbered, undefined, undefined, { signalId: "sig-y", mode: "on" });

    expect(out.blinded).toBe(true);
    const prompt = (routeMock.mock.calls[1][0] as { prompt: string }).prompt;
    expect(prompt).toContain("(no cited evidence)");
    expect(prompt).not.toContain("rival.example");
    expect(prompt.toLowerCase()).not.toContain("groq");
  });
});
