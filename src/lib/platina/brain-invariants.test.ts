/**
 * Structural invariants (Metacognitive Brain plan §7) — one named test per
 * row of that table, so the list cannot drift from the code. Started here
 * in B1 with the two rows B1 can actually prove; every other row is a named
 * `it.todo` left for the slice that builds it (B2/B3/B5/B6/B9), so the full
 * table is visible from this one file even before it is all provable.
 */
import { describe, expect, it, vi } from "vitest";
import { routeChatWithProvenance } from "@/lib/ai/router";
import { analysisWrites, UNTESTABLE_SKIP_CAUSE } from "./analysis-writes";
import { planAnalysis } from "./analysis-plan";
import { blindChallengerInput } from "./challenger";
import { nextRoundAllowed } from "./contradiction";
import { runContradictionRound, runInterrogationRound } from "./debate";
import { assertFalsifiableClaim } from "./falsifier-metrics";

// Hoisted, static mock — the same pattern analysis-plan.test.ts already
// uses successfully; a per-test vi.resetModules()+dynamic-import was tried
// first and was flaky/slow under the full suite (module-graph reimport cost
// pushed it past the default test timeout), so this file follows the
// established pattern instead of inventing a second one.
vi.mock("@/lib/ai/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/router")>();
  return { ...actual, routeChatWithProvenance: vi.fn() };
});
const routeMock = routeChatWithProvenance as unknown as ReturnType<typeof vi.fn>;

describe("invariant: no model call on unchanged content", () => {
  it("a plan that skips (own_brand, low_value, thin) never reaches the provider — proven at the pure-path level (planAnalysis), B1's share of this invariant; the unique content-hash index and the surprise filter (B4) are the other two legs", async () => {
    routeMock.mockReset();

    const signal = {
      title: "Roast guarantee",
      body: "Bluebird Roasters has introduced a 48-hour roast guarantee for wholesale buyers. ".repeat(8),
      sourceUrl: "https://bluebird.example/news/roast-guarantee",
      canonicalUrl: "https://bluebird.example/news/roast-guarantee",
      sourceKind: "competitor_site",
      fetchedAt: new Date("2026-09-21T09:00:00Z"),
    };
    const competitor = {
      kind: "competitor",
      brandName: "Bluebird Roasters",
      clientName: "Northwind Coffee",
      sourceKind: "competitor_site",
    };
    const noPrevious = () => Promise.resolve(null);

    const plans = await Promise.all([
      planAnalysis({ signal, subject: { ...competitor, kind: "own_brand" }, loadPrevious: noPrevious }),
      planAnalysis({
        signal: { ...signal, canonicalUrl: "https://bluebird.example/privacy", sourceUrl: "https://bluebird.example/privacy" },
        subject: competitor,
        loadPrevious: noPrevious,
      }),
      planAnalysis({ signal: { ...signal, body: "Call us." }, subject: competitor, loadPrevious: noPrevious }),
    ]);

    for (const plan of plans) {
      expect(plan.action).toBe("skip");
      // A caller that (incorrectly) tried to debate a skipped plan would be
      // the only way this invariant could be violated; there is no such
      // caller, and this asserts the router is never reached either way.
      if (plan.action === "analyse") await runContradictionRound(plan.input);
    }
    expect(routeMock).not.toHaveBeenCalled();
  });
});

describe("invariant: no insight without a testable falsifier", () => {
  it("the DB-layer guard (insertBrainChunk's call to assertFalsifiableClaim) refuses kind='claim' without a registry-valid falsifier", () => {
    expect(() => assertFalsifiableClaim("claim", null)).toThrow(/falsifier/i);
    const notInRegistry = { metric: "not_in_the_registry" };
    const inRegistry = { metric: "topic_momentum" };
    expect(() => assertFalsifiableClaim("claim", notInRegistry)).toThrow();
    expect(() => assertFalsifiableClaim("claim", inRegistry)).not.toThrow();
    // Never required for anything but a claim — a fact, a measured insight,
    // a compacted chunk and every pre-B1 legacy row (kind=null) pass through
    // with no falsifier at all.
    for (const kind of ["fact", "measured", "compacted", null, undefined] as const) {
      expect(() => assertFalsifiableClaim(kind, null)).not.toThrow();
    }
  });

  it("mode='on': an interrogation that failed validation writes no Brain chunk and no finding, regardless of the debate state (analysisWrites's v2 branch runs before the state is even consulted)", () => {
    const plan = { action: "analyse" as const, input: "x", changed: false };
    const context = { competitorName: "Bluebird Roasters", pageTitle: "Roast guarantee", sourceKind: "competitor_site" };
    // "agreed" is the state most likely to earn a chunk under every other
    // rule — proving the override holds even there is the strong form of
    // this invariant.
    const debate = {
      claim: { text: "Bluebird now guarantees a 48-hour roast.", evidenceSpans: [], specificity: 0.9 },
      attack: { text: "No material defect found.", confounders: [], strongestObjection: "no material objection", confounderStrength: 0 },
      result: { state: "agreed" as const, score: 0.95 },
      headline: "Bluebird now guarantees a 48-hour roast",
      nothingNew: false,
    };
    const writes = analysisWrites(plan, debate, context, {
      mode: "on",
      interrogation: { ok: false, reason: "The claim could not be tested: it cites no evidence from the input." },
      parsed: null,
      signalDocumentId: "sig_1",
      now: new Date(),
      promptVersion: "analysis-v2",
      writtenBy: "interrogation-v1",
    });
    expect(writes.brainChunk).toBeUndefined();
    expect(writes.finding).toBeUndefined();
    expect(writes.skip?.cause).toBe(UNTESTABLE_SKIP_CAUSE);
  });
});

// ---------------------------------------------------------------------------
// invariant: challenger blind, exactly once (B2)
// ---------------------------------------------------------------------------

describe("invariant: challenger blind, exactly once (B2)", () => {
  const spans = {
    e1: "Acme Roasters today announced a 48-hour roast guarantee for all wholesale customers.",
    e2: "The guarantee applies to orders placed after June 1, 2026.",
  };
  const numbered = {
    input:
      "Competitor: Acme Roasters\n" +
      "Source: a page on the competitor's own website — https://acme-roasters.example/news/guarantee\n\n" +
      `WHAT CHANGED — this is the signal:\n[e1] ${spans.e1}\n[e2] ${spans.e2}`,
    spans,
  };
  const interrogationReply = JSON.stringify({
    headline: "Acme now guarantees a 48-hour roast",
    what: "Acme now guarantees a 48-hour roast turnaround for wholesale orders.",
    why: ["e1", "e2"],
    how: "A faster guarantee than the industry standard signals a capacity investment.",
    kind: "claim",
    falsifier: { metric: "topic_momentum", subject: { topic: "roast speed" }, direction: "below", threshold: 1.0, window_days: 30 },
    confidence: "high",
  });
  const challengerReply = JSON.stringify({
    text: "No material defect found.",
    confounders: [],
    strongestObjection: "none",
    confounderStrength: 0,
    verdict: "no_material_objection",
  });

  it("blindChallengerInput itself carries only what/how/cited span texts — proposer provenance has no parameter to leak through", () => {
    const prompt = blindChallengerInput(
      { what: "Acme now guarantees a 48-hour roast turnaround.", how: "A faster guarantee signals a capacity investment.", why: ["e1", "e2"] },
      spans,
    );
    expect(prompt).toContain("Acme now guarantees a 48-hour roast turnaround.");
    expect(prompt).toContain("A faster guarantee signals a capacity investment.");
    expect(prompt).toContain(spans.e1);
    expect(prompt).toContain(spans.e2);
    for (const banned of ["groq", "gemini", "bedrock", "nvidia", "specificity", "confidence", "http", "acme-roasters.example"]) {
      expect(prompt.toLowerCase()).not.toContain(banned);
    }
  });

  it("mode='on': the live challenger call is sent the blind prompt, and the challenger is called exactly once", async () => {
    routeMock.mockReset();
    routeMock
      .mockResolvedValueOnce({ text: interrogationReply, provider: "groq", model: "llama-3-70b", latencyMs: 1 })
      .mockResolvedValueOnce({ text: challengerReply, provider: "gemini", model: "gemini-1.5-flash", latencyMs: 1 });

    const out = await runInterrogationRound(numbered, undefined, undefined, { signalId: "sig_1", mode: "on" });

    expect(out.blinded).toBe(true);
    // Exactly two router calls total for the whole round: one proposer, one
    // challenger — never a second challenger attempt once the first answers.
    expect(routeMock).toHaveBeenCalledTimes(2);
    const challengerCall = routeMock.mock.calls[1][0] as { system: string; prompt: string };
    const sent = `${challengerCall.system}\n${challengerCall.prompt}`;
    expect(sent).toContain(spans.e1);
    expect(sent).toContain(spans.e2);
    for (const banned of ["groq", "llama-3-70b", "specificity", "confidence", "http", "acme-roasters.example"]) {
      expect(sent.toLowerCase()).not.toContain(banned);
    }
  });

  it("mode='off' (or no challengerOpts): the live challenger call keeps today's unblinded prompt, unchanged", async () => {
    routeMock.mockReset();
    routeMock
      .mockResolvedValueOnce({ text: interrogationReply, provider: "groq", model: "llama-3-70b", latencyMs: 1 })
      .mockResolvedValueOnce({ text: challengerReply, provider: "gemini", model: "gemini-1.5-flash", latencyMs: 1 });

    const out = await runInterrogationRound(numbered);

    expect(out.blinded).toBe(false);
    const challengerCall = routeMock.mock.calls[1][0] as { system: string; prompt: string };
    expect(challengerCall.prompt).toContain("https://acme-roasters.example/news/guarantee");
  });

  it("a second contradiction round is forbidden, blind or not", () => {
    expect(nextRoundAllowed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Not yet provable — each row is the later slice that builds it (plan §7)
// ---------------------------------------------------------------------------

describe.todo("invariant: deterministic gates override every model (B3)");
it.todo("B3 — a gate refusal (min-N, significance, schema) produces no Brain write regardless of the debate's agreement state");

describe.todo("invariant: derived chunks stay under the context cap and are never self-cited (B6)");
it.todo("B6 — diversify's derived-share cap arithmetic (including cold start) and the lineage/self-citation refusal");

describe.todo("invariant: every metric declares its scale; no cross-scale comparison (B0, re-asserted here)");
it.todo("every FALSIFIER_METRICS entry has a scaleVersion, windows and minN; compareMeasurements throws across scale/window/segment");

describe.todo("invariant: refuted insights are demoted, never deleted (B5)");
it.todo("no delete query is exported for platina_brain_chunks; a grader refutation keeps the row (status=demoted, refuted_by_grade_id set)");

describe.todo("invariant: a human approves every output that leaves (B9, re-asserted here)");
it.todo("existing gate tests (gates.ts, publish gate) — unchanged by the Brain work; an insight also gains approve/edit/reject-with-reason");
