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
  getBrainChunksByIds,
  getWorkspaceConfig,
  lexicalBrainChunksQuery,
  lexicalBrandChunksQuery,
  similarBrainChunksQuery,
  similarBrandChunksQuery,
  touchBrainRetrieved,
} from "@/db/queries/platina";
import { listSimilarRefutedBrainChunks } from "@/db/queries/platina-grades";
import { modeOf } from "./brain-modes";
import { recordBrainEvent } from "./brain-telemetry";
import { DERIVED_SHARE } from "./context-budget";
import { embedText } from "./embed";
import { reciprocalRankFusion } from "./fusion";
import {
  DIVERSIFIED_POOL,
  selectDiversified,
  type BrainEvidenceRow,
  type FirstPartyEvidenceRow,
} from "./plan/diversified-evidence";
import { rerankCandidates } from "./rerank";
import type { HypothesisChunk, RetrievalBuckets } from "./retrieval";

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
  /**
   * W3b-rest (retrieval mode "on" only): one opposing or refuted Brain
   * hypothesis on the leading subject, kept separate from support.
   */
  counterHypothesis?: HypothesisChunk | null;
};

async function retrieveLegacyBuckets(
  workspaceId: string,
  topic: string,
  embedding: number[] | null,
): Promise<RetrievedBuckets> {
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

async function retrieveDiversifiedBuckets(input: {
  workspaceId: string;
  topic: string;
  embedding: number[] | null;
  derivedShare: number;
  budgetOn: boolean;
  rerank: boolean;
}) {
  const { workspaceId, topic, embedding } = input;
  const [vectorA, vectorC, lexicalA, lexicalC, refutedRows] = await Promise.all([
    embedding
      ? similarBrandChunksQuery(workspaceId, embedding, DIVERSIFIED_POOL)
      : Promise.resolve([]),
    embedding
      ? similarBrainChunksQuery(workspaceId, embedding, DIVERSIFIED_POOL)
      : Promise.resolve([]),
    lexicalBrandChunksQuery(workspaceId, topic, DIVERSIFIED_POOL),
    lexicalBrainChunksQuery(workspaceId, topic, DIVERSIFIED_POOL),
    embedding && typeof listSimilarRefutedBrainChunks === "function"
      ? listSimilarRefutedBrainChunks(workspaceId, embedding, 10)
      : Promise.resolve([]),
  ]);

  const fusedA = reciprocalRankFusion([
    { items: vectorA.map((r) => ({ id: r.id, content: r.content })) },
    { items: lexicalA.map((r) => ({ id: r.id, content: r.content })) },
  ]).slice(0, DIVERSIFIED_POOL);
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
  ]).slice(0, DIVERSIFIED_POOL);

  const fullBrainRows =
    typeof getBrainChunksByIds === "function"
      ? await getBrainChunksByIds(
          workspaceId,
          [...fusedC.map((f) => f.item.id), ...refutedRows.map((r) => r.id)],
        )
      : [];
  const fullById = new Map(fullBrainRows.map((r) => [r.id, r]));

  let orderedA = fusedA.map((f) => f.item);
  let orderedC = fusedC.map((f) => f.item);
  let reranked = false;
  if (input.rerank) {
    const [rA, rC] = await Promise.all([
      orderedA.length > 1 ? rerankCandidates(topic, orderedA, orderedA.length) : Promise.resolve({ items: orderedA, reranked: true }),
      orderedC.length > 1 ? rerankCandidates(topic, orderedC, orderedC.length) : Promise.resolve({ items: orderedC, reranked: true }),
    ]);
    orderedA = rA.items;
    orderedC = rC.items;
    reranked = rA.reranked && rC.reranked;
  }

  const now = new Date();
  const firstParty: FirstPartyEvidenceRow[] = orderedA.map((item) => ({
    id: item.id,
    kind: "brand",
    content: item.content,
    sourceUrl: null,
    createdAt: now,
  }));
  const toBrainRow = (item: { id: string; content: string; confidence: number; generation: number }): BrainEvidenceRow => {
    const full = fullById.get(item.id);
    return {
      id: item.id,
      content: full?.content ?? item.content,
      confidence: full?.confidence ?? item.confidence,
      createdAt: full?.createdAt ?? now,
      sourceSignalIds: full?.sourceSignalIds ?? [],
      absorbedChunkIds: full?.absorbedChunkIds ?? [],
      generation: full?.generation ?? item.generation,
      status: full?.status ?? "active",
      subjectKey: full?.subjectKey ?? null,
      direction: full?.direction ?? null,
      gradeState: full?.gradeState ?? null,
    };
  };
  const brainRows = orderedC.map(toBrainRow).filter((r) => r.status === "active");
  const refuted: BrainEvidenceRow[] = refutedRows.map((r) => {
    const full = fullById.get(r.id);
    return {
      id: r.id,
      content: full?.content ?? r.content,
      confidence: full?.confidence ?? r.confidence,
      createdAt: full?.createdAt ?? r.createdAt,
      sourceSignalIds: full?.sourceSignalIds ?? r.sourceSignalIds,
      absorbedChunkIds: full?.absorbedChunkIds ?? r.absorbedChunkIds,
      generation: full?.generation ?? r.generation,
      status: full?.status ?? r.status,
      subjectKey: full?.subjectKey ?? r.subjectKey,
      direction: full?.direction ?? r.direction,
      gradeState: full?.gradeState ?? r.gradeState,
    };
  });

  const selection = selectDiversified({
    brain: brainRows,
    refuted,
    firstParty,
    derivedShare: input.derivedShare,
    budgetOn: input.budgetOn,
    k: EVIDENCE_TAKE + HYPOTHESIS_TAKE,
  });

  const toHypo = (b: BrainEvidenceRow): HypothesisChunk => ({
    id: b.id,
    content: b.content,
    plane: "C" as const,
    confidence: b.confidence,
    generation: b.generation,
  });

  return {
    buckets: {
      evidence: selection.baseline.slice(0, EVIDENCE_TAKE).map((r) => ({
        id: r.id,
        content: r.content,
        plane: "A" as const,
      })),
      hypotheses: selection.pattern.slice(0, HYPOTHESIS_TAKE).map(toHypo),
      counterHypothesis: selection.counter ? toHypo(selection.counter) : null,
      bestEvidenceScore:
        vectorA.length > 0
          ? Math.max(...vectorA.map((r) => Number(r.score)))
          : null,
      hasEvidenceLexicalHit: lexicalA.length > 0,
      reranked,
    } satisfies RetrievedBuckets,
    stats: selection.stats,
  };
}

export async function retrieveBuckets(
  workspaceId: string,
  topic: string,
): Promise<RetrievedBuckets> {
  const [embedding, config] = await Promise.all([
    embedText(topic),
    typeof getWorkspaceConfig === "function"
      ? Promise.resolve(getWorkspaceConfig(workspaceId)).catch(() => null)
      : Promise.resolve(null),
  ]);
  const retrievalMode = modeOf(config, "retrieval");
  if (retrievalMode === "off") {
    return retrieveLegacyBuckets(workspaceId, topic, embedding);
  }

  const useDiversified = retrievalMode === "on";
  const derivedShare = config?.derivedContextShare ?? DERIVED_SHARE;
  const budgetOn = modeOf(config, "budget") === "on";

  if (useDiversified) {
    try {
      const { buckets, stats } = await retrieveDiversifiedBuckets({
        workspaceId,
        topic,
        embedding,
        derivedShare,
        budgetOn,
        rerank: true,
      });
      if (typeof touchBrainRetrieved === "function") {
        const usedIds = [
          ...buckets.hypotheses.map((h) => h.id),
          ...(buckets.counterHypothesis ? [buckets.counterHypothesis.id] : []),
        ];
        void Promise.all(usedIds.map((id) => touchBrainRetrieved(workspaceId, id))).catch(() => {});
      }
      void recordBrainEvent({
        workspaceId,
        stage: "retrieval",
        decision: "on",
        detail: { caller: "retrieveBuckets", ...stats },
      });
      return buckets;
    } catch (error) {
      void recordBrainEvent({
        workspaceId,
        stage: "retrieval",
        decision: "fallback",
        detail: {
          caller: "retrieveBuckets",
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return retrieveLegacyBuckets(workspaceId, topic, embedding);
    }
  }

  const [legacy, shadow] = await Promise.all([
    retrieveLegacyBuckets(workspaceId, topic, embedding),
    retrieveDiversifiedBuckets({
      workspaceId,
      topic,
      embedding,
      derivedShare,
      budgetOn,
      rerank: false,
    }).catch(() => null),
  ]);
  if (shadow) {
    const oldIds = new Set([
      ...legacy.evidence.map((e) => e.id),
      ...legacy.hypotheses.map((h) => h.id),
    ]);
    const newIds = [
      ...shadow.buckets.evidence.map((e) => e.id),
      ...shadow.buckets.hypotheses.map((h) => h.id),
    ];
    void recordBrainEvent({
      workspaceId,
      stage: "retrieval",
      decision: "shadow",
      detail: {
        caller: "retrieveBuckets",
        ...shadow.stats,
        overlap: newIds.filter((id) => oldIds.has(id)).length,
        oldCount: oldIds.size,
        newCount: newIds.length,
      },
    });
  }
  return legacy;
}
