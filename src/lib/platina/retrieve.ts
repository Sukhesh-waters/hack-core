/**
 * Semantic retrieval for solution drafting (Slice 5). Pipeline per plane:
 * vector candidates (version-filtered, R4.1) + lexical candidates (R4.4) →
 * reciprocal rank fusion → bounded rerank through the model router (R4.3,
 * honest fallback to the fused order) → the two buckets, never merged.
 *
 * The similarity floor (R4.2) is evaluated by the caller via relevanceGate —
 * this module reports the signals, the gate decides.
 */
import {
  lexicalBrainChunksQuery,
  lexicalBrandChunksQuery,
  similarBrainChunksQuery,
  similarBrandChunksQuery,
} from "@/db/queries/platina";
import { embedText } from "./embed";
import { reciprocalRankFusion } from "./fusion";
import { rerankCandidates } from "./rerank";
import type { RetrievalBuckets } from "./retrieval";

const VECTOR_CANDIDATES = 20;
const LEXICAL_CANDIDATES = 20;
const EVIDENCE_TAKE = 8;
const HYPOTHESIS_TAKE = 6;

export type RetrievedBuckets = RetrievalBuckets & {
  /** Best vector similarity among evidence candidates (null = no vectors). */
  bestEvidenceScore: number | null;
  /** At least one exact lexical hit on the evidence side. */
  hasEvidenceLexicalHit: boolean;
  /** False when the router scoring pass was unavailable and the fused
   *  order stands. */
  reranked: boolean;
};

export async function retrieveBuckets(
  workspaceId: string,
  topic: string,
): Promise<RetrievedBuckets> {
  const embedding = await embedText(topic);

  const [vectorA, vectorC, lexicalA, lexicalC] = await Promise.all([
    embedding
      ? similarBrandChunksQuery(workspaceId, embedding, VECTOR_CANDIDATES)
      : Promise.resolve([]),
    embedding
      ? similarBrainChunksQuery(workspaceId, embedding, VECTOR_CANDIDATES)
      : Promise.resolve([]),
    lexicalBrandChunksQuery(workspaceId, topic, LEXICAL_CANDIDATES),
    lexicalBrainChunksQuery(workspaceId, topic, LEXICAL_CANDIDATES),
  ]);

  const fusedA = reciprocalRankFusion([
    { items: vectorA.map((r) => ({ id: r.id, content: r.content })) },
    { items: lexicalA.map((r) => ({ id: r.id, content: r.content })) },
  ]);
  const fusedC = reciprocalRankFusion([
    {
      items: vectorC.map((r) => ({
        id: r.id,
        content: r.content,
        confidence: r.confidence,
        generation: r.generation,
      })),
    },
    {
      items: lexicalC.map((r) => ({
        id: r.id,
        content: r.content,
        confidence: r.confidence,
        generation: r.generation,
      })),
    },
  ]);

  const [rerankedA, rerankedC] = await Promise.all([
    rerankCandidates(topic, fusedA.map((f) => f.item), EVIDENCE_TAKE),
    rerankCandidates(topic, fusedC.map((f) => f.item), HYPOTHESIS_TAKE),
  ]);

  return {
    evidence: rerankedA.items.map((c) => ({
      id: c.id,
      content: c.content,
      plane: "A" as const,
    })),
    hypotheses: rerankedC.items.map((c) => ({
      id: c.id,
      content: c.content,
      plane: "C" as const,
      confidence: c.confidence,
      generation: c.generation,
    })),
    bestEvidenceScore:
      vectorA.length > 0
        ? Math.max(...vectorA.map((r) => Number(r.score)))
        : null,
    hasEvidenceLexicalHit: lexicalA.length > 0,
    reranked: rerankedA.reranked && rerankedC.reranked,
  };
}
