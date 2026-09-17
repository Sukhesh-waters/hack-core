import { describe, expect, it } from "vitest";
import {
  EVAL_K,
  EVAL_RELEVANCE_FLOOR,
  runRetrievalEval,
  type EvalRetrieve,
} from "./eval";
import { EVAL_CORPUS, EVAL_PAIRS } from "./eval-set";

describe("eval set integrity", () => {
  it("holds at least 30 hand-labelled pairs", () => {
    expect(EVAL_PAIRS.length).toBeGreaterThanOrEqual(30);
  });

  it("has unique queries", () => {
    const queries = EVAL_PAIRS.map((p) => p.query.toLowerCase());
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("covers all three categories", () => {
    for (const category of ["exact", "semantic", "negative"]) {
      expect(
        EVAL_PAIRS.some((p) => p.category === category),
        `no ${category} pairs`,
      ).toBe(true);
    }
  });

  it("every expectation references a real corpus record or null", () => {
    const keys = new Set(EVAL_CORPUS.map((r) => r.key));
    for (const pair of EVAL_PAIRS) {
      if (pair.expect !== null) {
        expect(keys.has(pair.expect), `${pair.query} -> ${pair.expect}`).toBe(
          true,
        );
      }
    }
  });

  it("corpus keys are unique", () => {
    const keys = EVAL_CORPUS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("runRetrievalEval", () => {
  // A deterministic fake store: a hit when the query shares a token with the
  // record content, scored by overlap — just enough to exercise the math.
  const fakeRetrieve: EvalRetrieve = async (query, k) => {
    const tokens = new Set(query.toLowerCase().split(/\W+/));
    return EVAL_CORPUS.map((record) => {
      const shared = record.content
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => tokens.has(t)).length;
      return { key: record.key, score: Math.min(1, shared / 4) };
    })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };

  it("scores a perfect fake retrieval at 100% recall", async () => {
    const pairs = EVAL_PAIRS.filter((p) => p.category === "exact").slice(0, 5);
    const report = await runRetrievalEval(pairs, fakeRetrieve);
    expect(report.recallAtK).toBe(1);
    expect(report.passed).toBe(report.total);
  });

  it("counts a miss when the expected record is absent from top-k", async () => {
    const neverFind: EvalRetrieve = async () => [];
    const report = await runRetrievalEval(
      [{ query: "Xevo TQ-GC", expect: "xevo-tq-gc", category: "exact" }],
      neverFind,
    );
    expect(report.recallAtK).toBe(0);
    expect(report.results[0].rank).toBeNull();
  });

  it("passes negatives only when nothing clears the relevance floor", async () => {
    const pair = {
      query: "unrelated",
      expect: null,
      category: "negative" as const,
    };
    const noisy: EvalRetrieve = async () => [
      { key: "xevo-tq-gc", score: EVAL_RELEVANCE_FLOOR + 0.1 },
    ];
    const quiet: EvalRetrieve = async () => [
      { key: "xevo-tq-gc", score: EVAL_RELEVANCE_FLOOR - 0.1 },
    ];
    expect((await runRetrievalEval([pair], noisy)).results[0].pass).toBe(false);
    expect((await runRetrievalEval([pair], quiet)).results[0].pass).toBe(true);
  });

  it("reports per-category breakdown", async () => {
    const report = await runRetrievalEval(EVAL_PAIRS.slice(0, 12), fakeRetrieve);
    expect(Object.keys(report.byCategory)).toEqual(
      expect.arrayContaining(["exact", "semantic"]),
    );
    expect(report.total).toBe(12);
  });

  it("respects k", async () => {
    const beyondK: EvalRetrieve = async (_query, k) =>
      EVAL_CORPUS.map((r) => ({ key: r.key, score: 0.9 })).slice(0, k);
    const report = await runRetrievalEval(
      [{ query: "q", expect: "empower-cds", category: "exact" }],
      beyondK,
      3,
    );
    // empower-cds is beyond position 3 in corpus order → miss
    expect(report.results[0].pass).toBe(false);
    expect(EVAL_K).toBe(5);
  });
});
