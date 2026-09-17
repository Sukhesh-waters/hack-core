/**
 * Live retrieval evaluation (R5.2). Runs only where real embeddings and the
 * database exist — locally or on staging with PLATINA_EVAL_LIVE=1 plus
 * GEMINI_API_KEY + DATABASE_URL. Bare CI skips it (same pattern as the
 * repo's integration tests); CI still runs the set-integrity and runner
 * tests in eval.test.ts.
 *
 * Measures BOTH the vector-only baseline and the full Slice 5 pipeline
 * (vector + lexical fused, reranked) and asserts the pipeline does not
 * regress against the baseline — the R4 done-when gate.
 *
 * The corpus is seeded into the e2e-fixture workspace tagged eval:// and
 * deleted afterwards. Nothing here touches a real workspace.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteEvalBrandChunks,
  insertBrandChunk,
  similarBrandChunksQuery,
} from "@/db/queries/platina";
import { embedText } from "./embed";
import { runRetrievalEval, type RankedHit } from "./eval";
import { EVAL_CORPUS, EVAL_PAIRS, EVAL_SOURCE_PREFIX } from "./eval-set";
import { retrieveBuckets } from "./retrieve";

const LIVE =
  process.env.PLATINA_EVAL_LIVE === "1" &&
  Boolean(process.env.GEMINI_API_KEY) &&
  Boolean(process.env.DATABASE_URL);
const WORKSPACE_ID = "1f3f82d4-470a-494d-8e56-29ac9372e94f"; // e2e fixture

const keyByContent = new Map(EVAL_CORPUS.map((r) => [r.content, r.key]));

describe.skipIf(!LIVE)("retrieval eval (live)", () => {
  beforeAll(async () => {
    await deleteEvalBrandChunks(WORKSPACE_ID);
    for (const record of EVAL_CORPUS) {
      const embedding = await embedText(record.content);
      if (!embedding) throw new Error("embedding unavailable — aborting eval");
      await insertBrandChunk({
        workspaceId: WORKSPACE_ID,
        content: record.content,
        sourceUrl: `${EVAL_SOURCE_PREFIX}${record.key}`,
        embedding,
      });
    }
  }, 120_000);

  afterAll(async () => {
    await deleteEvalBrandChunks(WORKSPACE_ID);
  });

  it(
    "pipeline recall@5 does not regress against the vector baseline",
    async () => {
      // Baseline: raw vector search only.
      const vectorOnly = async (query: string, k: number): Promise<RankedHit[]> => {
        const embedding = await embedText(query);
        if (!embedding) return [];
        const rows = await similarBrandChunksQuery(WORKSPACE_ID, embedding, k);
        return rows
          .filter((r) => r.sourceUrl?.startsWith(EVAL_SOURCE_PREFIX))
          .map((r, i) => ({
            key: r.sourceUrl!.slice(EVAL_SOURCE_PREFIX.length),
            score: 1 - i * 0.01,
          }));
      };

      // Full pipeline: fused vector + lexical, reranked (retrieveBuckets).
      const fullPipeline = async (query: string, k: number): Promise<RankedHit[]> => {
        const buckets = await retrieveBuckets(WORKSPACE_ID, query);
        return buckets.evidence
          .map((e) => keyByContent.get(e.content))
          .filter((key): key is string => Boolean(key))
          .slice(0, k)
          .map((key, i) => ({ key, score: 1 - i * 0.01 }));
      };

      const baseline = await runRetrievalEval(EVAL_PAIRS, vectorOnly);
      const pipeline = await runRetrievalEval(EVAL_PAIRS, fullPipeline);
      console.log(
        `eval recall@5 — vector baseline: ${(baseline.recallAtK * 100).toFixed(1)}% ` +
          `(${baseline.passed}/${baseline.total}); full pipeline: ` +
          `${(pipeline.recallAtK * 100).toFixed(1)}% (${pipeline.passed}/${pipeline.total})`,
      );
      console.log("pipeline by category:", JSON.stringify(pipeline.byCategory));
      // No regression beyond a small tolerance for reranker nondeterminism.
      expect(pipeline.recallAtK).toBeGreaterThanOrEqual(
        baseline.recallAtK - 0.05,
      );
    },
    600_000,
  );
});
