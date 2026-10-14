/**
 * W3b — the planner's evidence through B6 (anti-echo) and B7 (budget).
 *
 * Today's path (context.ts) takes the top six Brain chunks and the top six
 * first-party passages by similarity. That is how an echo chamber forms in a
 * self-learning loop: near-duplicate derived hypotheses fill the context,
 * crowd out the client's own data, and nothing argues back. This path widens
 * the pool, then:
 *   - MMR drops near-duplicates;
 *   - lineage dedup keeps a chunk and its own sources from both appearing;
 *   - derived (Brain) chunks get at most `derivedShare` of the evidence budget;
 *   - refuted chunks can never support anything (diversify.ts);
 *   - one counter-evidence slot: an opposite-direction chunk on the leading
 *     hypothesis's subject, or a refuted one (a recorded failure).
 *
 * Planes are never merged: first-party (A) and public-derived (B) come back
 * as separate lists, and the counter item keeps its plane (two-layer rule).
 *
 * Round trips match today's path: the refuted-chunk query runs in the same
 * parallel batch as the support queries. `selectDiversified` is pure.
 */
import {
  getBrainChunksByIds,
  lexicalBrainChunksQuery,
  listSignalProvenance,
  similarBrainChunksQuery,
} from "@/db/queries/platina";
import { listSimilarRefutedBrainChunks } from "@/db/queries/platina-grades";
import { similarFirstPartyChunksQuery } from "@/db/queries/platina-learning";
import { EVIDENCE_TOKEN_BUDGET, estimateTokens, fitSections } from "@/lib/platina/context-budget";
import { diversifyEvidence, type Candidate, type DiversifyStats } from "@/lib/platina/diversify";
import { reciprocalRankFusion } from "@/lib/platina/fusion";
import { rerankCandidates } from "@/lib/platina/rerank";
import { relevanceGate } from "@/lib/platina/retrieval";
import type { EvidenceStatus, Scope } from "./context";
import type { PlanEvidence } from "./evidence";

/** Support items kept across both planes (plan §5 B7: retrieve ~50, keep ~8). */
export const DIVERSIFIED_K = 8;
/** Candidate pool per Brain query. */
export const DIVERSIFIED_POOL = 50;
/** Evidence text the planner sees per item (renderEvidenceBlock truncates here). */
const RENDERED_CHARS = 400;

export type BrainEvidenceRow = {
  id: string;
  content: string;
  confidence: number;
  createdAt: Date;
  sourceSignalIds: string[];
  absorbedChunkIds: string[];
  generation: number;
  status: string;
  subjectKey: string | null;
  direction: string | null;
  gradeState: string | null;
};

export type FirstPartyEvidenceRow = {
  id: string;
  kind: string;
  content: string;
  sourceUrl: string | null;
  createdAt: Date;
};

export type DiversifiedSelection = {
  /** Plane A support, best first. */
  baseline: FirstPartyEvidenceRow[];
  /** Plane B support, best first. */
  pattern: BrainEvidenceRow[];
  counter: BrainEvidenceRow | null;
  stats: DiversifyStats & { budgetDropped: number };
};

const DIRECTIONS = new Set(["up", "down", "none"]);
const GRADE_STATES = new Set(["untested", "holding", "promoted", "refuted", "insufficient"]);

/** Position in its own list → relevance in (0, 1]; both planes share the scale. */
const rankRelevance = (index: number, length: number) => 1 - index / Math.max(1, length);

const renderedTokens = (c: Candidate) => estimateTokens(c.content.slice(0, RENDERED_CHARS));

function brainCandidate(row: BrainEvidenceRow, relevance: number): Candidate {
  return {
    id: row.id,
    content: row.content,
    relevance,
    derived: true,
    plane: "B",
    subjectKey: row.subjectKey,
    direction: row.direction && DIRECTIONS.has(row.direction) ? (row.direction as Candidate["direction"]) : null,
    gradeState:
      row.gradeState && GRADE_STATES.has(row.gradeState) ? (row.gradeState as Candidate["gradeState"]) : null,
    status: row.status,
    generation: row.generation,
    lineage: { sourceSignalIds: row.sourceSignalIds, absorbedChunkIds: row.absorbedChunkIds },
  };
}

/**
 * Pure selection: both ranked lists plus refuted chunks in, two plane lists
 * and one counter item out. `budgetOn` additionally holds the whole support
 * set to the evidence token budget (B7), dropping whole items from the bottom.
 */
export function selectDiversified(input: {
  brain: BrainEvidenceRow[];
  refuted: BrainEvidenceRow[];
  firstParty: FirstPartyEvidenceRow[];
  derivedShare: number;
  budgetOn: boolean;
  k?: number;
  evidenceTokenBudget?: number;
}): DiversifiedSelection {
  const k = input.k ?? DIVERSIFIED_K;
  const evidenceTokenBudget = input.evidenceTokenBudget ?? EVIDENCE_TOKEN_BUDGET;
  const supportIds = new Set(input.brain.map((b) => b.id));
  const refuted = input.refuted.filter((r) => !supportIds.has(r.id));

  const candidates: Candidate[] = [
    ...input.firstParty.map((row, i) => ({
      id: row.id,
      content: row.content,
      relevance: rankRelevance(i, input.firstParty.length),
      derived: false,
      plane: "A" as const,
    })),
    ...input.brain.map((row, i) => brainCandidate(row, rankRelevance(i, input.brain.length))),
    // Below every support candidate: they only ever reach the counter slot.
    ...refuted.map((row, i) => brainCandidate(row, 0.1 * rankRelevance(i, refuted.length))),
  ];

  const result = diversifyEvidence({
    candidates,
    k,
    evidenceTokenBudget,
    derivedShare: input.derivedShare,
    tokensOf: renderedTokens,
  });

  let support = result.items.filter((i) => i.role === "support").map((i) => i.candidate);
  let budgetDropped = 0;
  if (input.budgetOn) {
    const ordered = [...support].sort((a, b) => b.relevance - a.relevance);
    const fitted = fitSections(
      { evidence: ordered.map((c) => ({ id: c.id, text: c.content.slice(0, RENDERED_CHARS) })) },
      { evidence: { cap: evidenceTokenBudget } },
    );
    const kept = new Set(fitted.sections.evidence.kept.map((i) => i.id));
    budgetDropped = support.length - kept.size;
    support = support.filter((c) => kept.has(c.id));
  }

  const keptIds = new Set(support.map((c) => c.id));
  const counterId = result.items.find((i) => i.role === "disconfirming")?.candidate.id ?? null;
  const byBrainId = new Map([...input.brain, ...refuted].map((r) => [r.id, r]));

  return {
    baseline: input.firstParty.filter((r) => keptIds.has(r.id)),
    pattern: input.brain.filter((r) => keptIds.has(r.id)),
    counter: counterId ? (byBrainId.get(counterId) ?? null) : null,
    stats: { ...result.stats, budgetDropped },
  };
}

export type DiversifiedEvidence = {
  patternEvidence: PlanEvidence[];
  baselineEvidence: PlanEvidence[];
  counterEvidence: PlanEvidence | null;
  status: EvidenceStatus;
  stats: DiversifiedSelection["stats"];
};

/**
 * The planner's evidence through the anti-echo path. Mirrors context.ts's
 * floor and scope rules (no evidence beats noise; a client-scoped plan sees
 * only that client's, its competitors' and workspace-wide signals).
 */
export async function retrieveDiversifiedEvidence(input: {
  workspaceId: string;
  brief: string;
  brandId: string | null;
  floor: number;
  scope: Scope | null;
  newSince: Date | null;
  embedding: number[] | null;
  derivedShare: number;
  budgetOn: boolean;
  /** False in shadow mode: no extra model call just to log a comparison. */
  rerank: boolean;
}): Promise<DiversifiedEvidence> {
  const { workspaceId, brief, floor, scope, embedding } = input;
  const scopeEmpty = scope !== null && scope.signalIds.size === 0;

  const [vector, lexical, refutedRows, firstParty] = await Promise.all([
    embedding && !scopeEmpty ? similarBrainChunksQuery(workspaceId, embedding, DIVERSIFIED_POOL) : Promise.resolve([]),
    scopeEmpty ? Promise.resolve([]) : lexicalBrainChunksQuery(workspaceId, brief, DIVERSIFIED_POOL),
    embedding && !scopeEmpty ? listSimilarRefutedBrainChunks(workspaceId, embedding, 10) : Promise.resolve([]),
    embedding
      ? similarFirstPartyChunksQuery(workspaceId, embedding, { brandId: input.brandId, limit: DIVERSIFIED_K * 2 })
      : Promise.resolve([]),
  ]);

  const baselineRows: FirstPartyEvidenceRow[] = firstParty
    .filter((r) => Number(r.score) >= floor)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      content: r.kind === "lesson" ? `Lesson from our own results: ${r.content}` : r.content,
      sourceUrl: r.sourceUrl,
      createdAt: r.createdAt,
    }));

  let status: EvidenceStatus = "matched";
  let brainRows: BrainEvidenceRow[] = [];
  if (scopeEmpty) {
    status = "no_client_evidence";
  } else {
    const gate = relevanceGate(
      {
        bestVectorScore: vector.length > 0 ? Math.max(...vector.map((r) => Number(r.score))) : null,
        hasLexicalHit: lexical.length > 0,
      },
      floor,
    );
    if (gate.status !== "ready") {
      status = embedding !== null && vector.length === 0 && lexical.length === 0 ? "empty_brain" : "none_relevant";
    } else {
      const fused = reciprocalRankFusion([
        { items: vector.filter((r) => Number(r.score) >= floor).map((r) => ({ id: r.id })) },
        { items: lexical.map((r) => ({ id: r.id })) },
      ]).slice(0, DIVERSIFIED_POOL);
      const rows = await getBrainChunksByIds(
        workspaceId,
        [...fused.map((f) => f.item.id), ...refutedRows.map((r) => r.id)],
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      const inScope = (r: { sourceSignalIds: string[] }) =>
        !scope || r.sourceSignalIds.some((id) => scope.signalIds.has(id));
      brainRows = fused
        .map((f) => byId.get(f.item.id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.status === "active")
        .filter(inScope)
        .map(toBrainRow);
      if (input.rerank && brainRows.length > 1) {
        const { items } = await rerankCandidates(
          brief,
          brainRows.map((r) => ({ id: r.id, content: r.content })),
          brainRows.length,
        );
        const order = new Map(items.map((c, i) => [c.id, i]));
        brainRows = [...brainRows].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
      }
      if (brainRows.length === 0) status = "none_relevant";
    }
  }

  const refuted = refutedRows
    .filter((r) => !scope || r.sourceSignalIds.some((id) => scope.signalIds.has(id)))
    .map(toBrainRow);

  const selection = selectDiversified({
    brain: brainRows,
    refuted,
    firstParty: baselineRows,
    derivedShare: input.derivedShare,
    budgetOn: input.budgetOn,
  });

  const brainUsed = [...selection.pattern, ...(selection.counter ? [selection.counter] : [])];
  const signals = new Map(
    (
      await listSignalProvenance(
        workspaceId,
        Array.from(new Set(brainUsed.flatMap((c) => c.sourceSignalIds.slice(0, 1)))),
      )
    ).map((s) => [s.id, s]),
  );
  const isNew = (createdAt: Date) => (input.newSince && createdAt > input.newSince ? { isNew: true } : {});
  const fromBrain = (c: BrainEvidenceRow): PlanEvidence => {
    const signal = signals.get(c.sourceSignalIds[0] ?? "");
    return {
      id: c.id,
      plane: "B",
      content: c.content,
      sourceUrl: signal?.sourceUrl ?? null,
      collectedAt: signal?.fetchedAt ?? c.createdAt,
      confidence: c.confidence,
      ...isNew(c.createdAt),
    };
  };

  return {
    patternEvidence: selection.pattern.map(fromBrain),
    baselineEvidence: selection.baseline.map((r) => ({
      id: r.id,
      plane: "A" as const,
      content: r.content,
      sourceUrl: r.sourceUrl,
      collectedAt: r.createdAt,
      confidence: null,
      ...isNew(r.createdAt),
    })),
    counterEvidence: selection.counter ? { ...fromBrain(selection.counter), role: "counter" } : null,
    status,
    stats: selection.stats,
  };
}

function toBrainRow(r: {
  id: string;
  content: string;
  confidence: number;
  createdAt: Date;
  sourceSignalIds: string[];
  absorbedChunkIds: string[];
  generation: number;
  status: string;
  subjectKey: string | null;
  direction: string | null;
  gradeState: string | null;
}): BrainEvidenceRow {
  return {
    id: r.id,
    content: r.content,
    confidence: r.confidence,
    createdAt: r.createdAt,
    sourceSignalIds: r.sourceSignalIds,
    absorbedChunkIds: r.absorbedChunkIds,
    generation: r.generation,
    status: r.status,
    subjectKey: r.subjectKey,
    direction: r.direction,
    gradeState: r.gradeState,
  };
}
