/**
 * Live retrieval evaluation (R5.2). Runs only where real embeddings and the
 * database exist — locally or on staging with GEMINI_API_KEY + DATABASE_URL
 * set. Bare CI skips it (same pattern as the repo's integration tests); CI
 * still runs the set-integrity and runner tests in eval.test.ts.
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

const LIVE =
  process.env.PLATINA_EVAL_LIVE === "1" &&
  Boolean(process.env.GEMINI_API_KEY) &&
  Boolean(process.env.DATABASE_URL);
const WORKSPACE_ID = "1f3f82d4-470a-494d-8e56-29ac9372e94f"; // e2e fixture

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
    "recall@5 over the labelled set",
    async () => {
      const retrieve = async (query: string, k: number): Promise<RankedHit[]> => {
        const embedding = await embedText(query);
        if (!embedding) return [];
        const rows = await similarBrandChunksQuery(WORKSPACE_ID, embedding, k);
        return rows
          .filter((r) => r.sourceUrl?.startsWith(EVAL_SOURCE_PREFIX))
          .map((r, i) => ({
            key: r.sourceUrl!.slice(EVAL_SOURCE_PREFIX.length),
            // Rank position as a proxy score; the floor check for negatives
            // is exercised structurally in eval.test.ts.
            score: 1 - i * 0.01,
          }));
      };
      const report = await runRetrievalEval(EVAL_PAIRS, retrieve);
      console.log(
        `eval recall@5: ${(report.recallAtK * 100).toFixed(1)}% ` +
          `(${report.passed}/${report.total})`,
        JSON.stringify(report.byCategory),
      );
      // The floor the harness must hold. R4.3/R4.4 changes compare against
      // this number before they may merge.
      expect(report.recallAtK).toBeGreaterThanOrEqual(0.6);
    },
    300_000,
  );
});
