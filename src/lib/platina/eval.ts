/**
 * Retrieval evaluation runner (R5.2). Deps are injected: unit tests drive a
 * fake store; live mode (eval.live.test.ts, skipped without GEMINI_API_KEY +
 * DATABASE_URL) drives real embeddings against the e2e-fixture workspace.
 *
 * Metric: recall@k — the expected record appears in the top k. A negative
 * pair passes when no result clears the relevance floor (R4.2 foreshadowed:
 * a forced match on an unrelated query is a failure, not a find).
 */
import type { EvalPair } from "./eval-set";

export type RankedHit = { key: string; score: number };
export type EvalRetrieve = (query: string, k: number) => Promise<RankedHit[]>;

export const EVAL_K = 5;
export const EVAL_RELEVANCE_FLOOR = 0.5;

export type EvalResult = {
  query: string;
  expect: string | null;
  category: EvalPair["category"];
  pass: boolean;
  rank: number | null;
  topScore: number | null;
};

export type EvalReport = {
  total: number;
  passed: number;
  recallAtK: number;
  byCategory: Record<string, { total: number; passed: number }>;
  results: EvalResult[];
};

export async function runRetrievalEval(
  pairs: EvalPair[],
  retrieve: EvalRetrieve,
  k = EVAL_K,
  relevanceFloor = EVAL_RELEVANCE_FLOOR,
): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const pair of pairs) {
    const hits = await retrieve(pair.query, k);
    const topScore = hits[0]?.score ?? null;
    if (pair.expect === null) {
      // Negative: pass when nothing relevant is found.
      const anyRelevant = hits.some((h) => h.score >= relevanceFloor);
      results.push({
        query: pair.query,
        expect: null,
        category: pair.category,
        pass: !anyRelevant,
        rank: null,
        topScore,
      });
      continue;
    }
    const rank = hits.findIndex((h) => h.key === pair.expect);
    results.push({
      query: pair.query,
      expect: pair.expect,
      category: pair.category,
      pass: rank >= 0,
      rank: rank >= 0 ? rank + 1 : null,
      topScore,
    });
  }

  const byCategory: EvalReport["byCategory"] = {};
  for (const r of results) {
    byCategory[r.category] ??= { total: 0, passed: 0 };
    byCategory[r.category].total += 1;
    if (r.pass) byCategory[r.category].passed += 1;
  }
  const passed = results.filter((r) => r.pass).length;
  return {
    total: results.length,
    passed,
    recallAtK: results.length === 0 ? 0 : passed / results.length,
    byCategory,
    results,
  };
}
