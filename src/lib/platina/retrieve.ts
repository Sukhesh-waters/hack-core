import {
  similarBrainChunksQuery,
  similarBrandChunksQuery,
} from "@/db/queries/platina";
import { routeAI } from "@/lib/ai/router";
import { type RetrievalBuckets } from "./retrieval";

export async function retrieveBuckets(
  workspaceId: string,
  topic: string,
): Promise<RetrievalBuckets> {
  const [embedding] = await routeAI({ kind: "embed", texts: [topic] });
  const [evidence, hypotheses] = await Promise.all([
    similarBrandChunksQuery(workspaceId, embedding),
    similarBrainChunksQuery(workspaceId, embedding),
  ]);

  return {
    evidence: evidence.map((row) => ({
      id: row.id,
      content: row.content,
      plane: "A" as const,
    })),
    hypotheses: hypotheses.map((row) => ({
      id: row.id,
      content: row.content,
      plane: "C" as const,
      confidence: row.confidence,
      generation: row.generation,
    })),
  };
}
