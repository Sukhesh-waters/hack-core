/**
 * Structural invariants (Metacognitive Brain plan §7) — one named test per
 * row of that table, so the list cannot drift from the code. Started here
 * in B1 with the two rows B1 can actually prove; every other row is a named
 * `it.todo` left for the slice that builds it (B2/B3/B5/B6/B9), so the full
 * table is visible from this one file even before it is all provable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { routeChatWithProvenance } from "@/lib/ai/router";
import { dueFalsifierChunksQuery, refutedChunksBySubjectQuery } from "@/db/queries/platina-grades";
import { lexicalBrainChunksQuery, similarBrainChunksQuery } from "@/db/queries/platina";
import { analysisWrites, UNTESTABLE_SKIP_CAUSE } from "./analysis-writes";
import { planAnalysis } from "./analysis-plan";
import { runContradictionRound } from "./debate";
import { gradeInsight } from "./falsifier-grade";
import { assertFalsifiableClaim } from "./falsifier-metrics";
import type { FalsifierClaim } from "./falsifier-metrics";

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
// Not yet provable — each row is the later slice that builds it (plan §7)
// ---------------------------------------------------------------------------

describe.todo("invariant: challenger blind, exactly once (B2)");
it.todo(
  "B2 — the blinded prompt string contains none of: proposer provider id, model id, specificity, confidence, http, source domain; nextRoundAllowed() === false",
);

describe.todo("invariant: deterministic gates override every model (B3)");
it.todo("B3 — a gate refusal (min-N, significance, schema) produces no Brain write regardless of the debate's agreement state");

describe.todo("invariant: derived chunks stay under the context cap and are never self-cited (B6)");
it.todo("B6 — diversify's derived-share cap arithmetic (including cold start) and the lineage/self-citation refusal");

describe.todo("invariant: every metric declares its scale; no cross-scale comparison (B0, re-asserted here)");
it.todo("every FALSIFIER_METRICS entry has a scaleVersion, windows and minN; compareMeasurements throws across scale/window/segment");

describe("invariant: refuted insights are demoted, never deleted (B5)", () => {
  it("no delete query is exported for platina_brain_chunks anywhere in db/queries/platina.ts", () => {
    const source = readFileSync(join(__dirname, "..", "..", "db", "queries", "platina.ts"), "utf-8");
    expect(source).not.toMatch(/\.delete\(\s*platinaBrainChunks\s*\)/);
  });

  it("a triggered falsifier is refuted (plan §5 B5's rule table) — the grader's decision, proved on the pure path", () => {
    const falsifier: FalsifierClaim = {
      metric: "topic_momentum",
      subject: { topic: "pfas analysis" },
      direction: "below",
      threshold: 1.0,
      window_days: 30,
    };
    const graded = gradeInsight({
      falsifier,
      measurement: { status: "measured", value: 0.4, n: 8 },
      now: new Date("2026-11-20T05:00:00Z"),
      dueAt: new Date("2026-11-19T00:00:00Z"),
    });
    expect(graded.verdict).toBe("refuted");
    // The grader's write path (falsifier-grade.ts in the Inngest handler)
    // turns this into setBrainState({ status: "demoted", gradeState:
    // "refuted", confidence: 0.05 }, "grading", gradeId) — an UPDATE, never a
    // DELETE; the row-keeping half of this invariant is the test above.
  });

  it("a fact (kind='fact', no falsifier) is structurally excluded from the due-chunks query the grader reads", () => {
    const { sql, params } = dueFalsifierChunksQuery("ws_a", new Date("2026-11-20T05:00:00Z")).toSQL();
    // Facts always have kind="fact" and falsifier=null (analysis-writes.ts
    // brainChunkV2Fields; market-insight-writer.ts never writes one either):
    // both conditions below exclude them, independent of grade_state.
    expect(sql).toContain('"platina_brain_chunks"."kind" in');
    expect(params).not.toContain("fact");
    expect(sql).toMatch(/"falsifier" is not null/);
  });

  it("a refuted (demoted) chunk is excluded by both support-retrieval queries, which filter status='active'", () => {
    const vector = similarBrainChunksQuery("ws_a", [0.1, 0.2]).toSQL();
    expect(vector.sql).toContain('"platina_brain_chunks"."status" = ');
    expect(vector.params).toContain("active");

    const lexical = lexicalBrainChunksQuery("ws_a", "pfas").toSQL();
    expect(lexical.sql).toContain('"platina_brain_chunks"."status" = ');
    expect(lexical.params).toContain("active");
  });

  it("a refuted chunk IS returned by the subject-scoped refuted query (B6's counter-evidence slot reads status=demoted, grade_state=refuted)", () => {
    const { sql, params } = refutedChunksBySubjectQuery("ws_a", "brand:acme|topic:pfas analysis").toSQL();
    expect(sql).toContain('"platina_brain_chunks"."status" = ');
    expect(sql).toContain('"platina_brain_chunks"."grade_state" = ');
    expect(params).toEqual(expect.arrayContaining(["demoted", "refuted"]));
  });
});

describe.todo("invariant: a human approves every output that leaves (B9, re-asserted here)");
it.todo("existing gate tests (gates.ts, publish gate) — unchanged by the Brain work; an insight also gains approve/edit/reject-with-reason");
