import type { ClientProfile, PlanDoc } from "@/db/platina-schema";
import {
  getBrainChunksByIds,
  getBrand,
  getWorkspaceConfig,
  lexicalBrainChunksQuery,
  listCompetitorsOf,
  listPlanLessons,
  listSignalIdsForBrands,
  listSignalProvenance,
  listWorkspaceWideSignalIds,
  similarBrainChunksQuery,
} from "@/db/queries/platina";
import { logContextAssembly, type ContextResult } from "@/lib/ai/context/types";
import { embedText } from "@/lib/platina/embed";
import { reciprocalRankFusion } from "@/lib/platina/fusion";
import { rerankCandidates } from "@/lib/platina/rerank";
import {
  DEFAULT_SIMILARITY_FLOOR,
  relevanceGate,
} from "@/lib/platina/retrieval";
import { EVIDENCE_TOP_K, type PlanEvidence } from "./evidence";

export type { PlanEvidence } from "./evidence";

export type PlanLesson = {
  title: string;
  brief: string;
  /** The past plan's summary plus the channels it used. */
  summary: string;
  /** What the team recorded about how it went. */
  note: string | null;
};

/** The earlier plan a revision starts from. */
export type PlanRevisionInput = {
  title: string;
  summary: string;
  /** One line per phase: "Days 1-7 · Email · Prep". */
  phases: string[];
  createdAt: Date;
};

export type PlanContextParams = {
  workspaceId: string;
  brief: string;
  /** Scope evidence to this client and its competitors. Null = whole workspace. */
  brandId?: string | null;
  /** A fixed date the plan must land on. */
  anchor?: { label: string; day: number } | null;
  revisionOf?: PlanRevisionInput | null;
};

/**
 * Why the evidence list looks the way it does. Shown to the user so an
 * ungrounded plan says *why* it is ungrounded.
 */
export type EvidenceStatus =
  | "matched"
  | "none_relevant"
  | "empty_brain"
  | "no_client_evidence";

export type PlanContext = {
  brief: string;
  worked: PlanLesson[];
  failed: PlanLesson[];
  /** Plane B — derived from public/Apify signals that survived validation. */
  patternEvidence: PlanEvidence[];
  /** Plane A — first-party baseline. Empty until the baseline engine feeds it. */
  baselineEvidence: PlanEvidence[];
  /**
   * True when neither logged results nor collected evidence informed the plan.
   * Lives inside the context on purpose: ContextState is a closed union.
   */
  coldStart: boolean;
  evidenceStatus: EvidenceStatus;
  /** Client the evidence was scoped to, when any. */
  scopeLabel: string | null;
  /**
   * What the client says about itself (derived from its own website). Context
   * for staying on-brand — never evidence, so it is not citable.
   */
  clientProfile: ClientProfile | null;
  anchor: { label: string; day: number } | null;
  revisionOf: PlanRevisionInput | null;
};

function toLesson(row: {
  title: string;
  brief: string;
  plan: PlanDoc;
  note: string | null;
}): PlanLesson {
  const channels = Array.from(new Set(row.plan.phases.map((p) => p.channel)));
  return {
    title: row.title,
    brief: row.brief,
    summary: `${row.plan.summary} Channels: ${channels.join(", ")}.`,
    note: row.note,
  };
}

const CANDIDATES = 20;
/** Scoped retrieval filters after the fact, so it looks at a wider pool. */
const SCOPED_CANDIDATES = 60;
const RERANK_POOL = 12;

export type Scope = {
  label: string;
  signalIds: Set<string>;
  profile: ClientProfile | null;
};

/** A client and its competitors' collected signals. Null when unscoped. */
export async function resolveScope(
  workspaceId: string,
  brandId: string | null | undefined,
): Promise<Scope | null> {
  if (!brandId) return null;
  // One round, not three: the brand, its competitors (empty unless it is a
  // client) and the workspace-wide sources do not depend on each other.
  const [brand, related, shared] = await Promise.all([
    getBrand(workspaceId, brandId),
    listCompetitorsOf(workspaceId, brandId),
    listWorkspaceWideSignalIds(workspaceId),
  ]);
  if (!brand) return null;
  const competitors = brand.kind === "own_brand" ? related : [];
  const ids = await listSignalIdsForBrands(workspaceId, [brand.id, ...competitors.map((c) => c.id)]);
  // Workspace-wide sources (event pages, trade press) are market context for
  // every client here; without them a client-scoped plan never saw the
  // events calendar (C5).
  return { label: brand.name, signalIds: new Set([...ids, ...shared]), profile: brand.profile ?? null };
}

/**
 * Public-signal patterns relevant to the brief, through the existing Brain
 * retrieval building blocks: vector + lexical candidates, reciprocal rank
 * fusion, the relevance floor, then a bounded rerank (honest fallback to the
 * fused order if the router pass is unavailable). Scoped to a client when one
 * is given. Below the floor — or with nothing for that client — the planner
 * gets no evidence rather than noise, the plan is still written, and the
 * status says why. A router outage on embed degrades to lexical-only.
 */
async function retrievePatternEvidence(input: {
  workspaceId: string;
  brief: string;
  floor: number;
  scope: Scope | null;
  newSince: Date | null;
}): Promise<{ items: PlanEvidence[]; status: EvidenceStatus }> {
  const { workspaceId, brief, floor, scope } = input;
  if (scope && scope.signalIds.size === 0) {
    return { items: [], status: "no_client_evidence" };
  }
  const pool = scope ? SCOPED_CANDIDATES : CANDIDATES;
  const embedding = await embedText(brief);
  const [vector, lexical] = await Promise.all([
    embedding
      ? similarBrainChunksQuery(workspaceId, embedding, pool)
      : Promise.resolve([]),
    lexicalBrainChunksQuery(workspaceId, brief, pool),
  ]);

  const gate = relevanceGate(
    {
      bestVectorScore:
        vector.length > 0 ? Math.max(...vector.map((r) => Number(r.score))) : null,
      hasLexicalHit: lexical.length > 0,
    },
    floor,
  );
  if (gate.status !== "ready") {
    const empty = embedding !== null && vector.length === 0 && lexical.length === 0;
    return { items: [], status: empty ? "empty_brain" : "none_relevant" };
  }

  // Vector-only candidates below the floor are noise; lexical hits stand.
  const relevantVector = vector.filter((r) => Number(r.score) >= floor);
  const fused = reciprocalRankFusion([
    { items: relevantVector.map((r) => ({ id: r.id })) },
    { items: lexical.map((r) => ({ id: r.id })) },
  ]).slice(0, scope ? pool : RERANK_POOL);
  if (fused.length === 0) return { items: [], status: "none_relevant" };

  const chunks = await getBrainChunksByIds(
    workspaceId,
    fused.map((f) => f.item.id),
  );
  const byId = new Map(chunks.map((c) => [c.id, c]));
  // Keep the fused order; drop anything outside the client's own signals.
  const ordered = fused
    .map((f) => byId.get(f.item.id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .filter(
      (c) => !scope || c.sourceSignalIds.some((id) => scope.signalIds.has(id)),
    )
    .slice(0, RERANK_POOL);
  if (ordered.length === 0) return { items: [], status: "none_relevant" };

  const { items: reranked } = await rerankCandidates(
    brief,
    ordered.map((c) => ({ id: c.id, content: c.content })),
    EVIDENCE_TOP_K,
  );
  const top = reranked.flatMap((r) => {
    const chunk = byId.get(r.id);
    return chunk ? [chunk] : [];
  });

  const signalIds = Array.from(
    new Set(top.flatMap((c) => c.sourceSignalIds.slice(0, 1))),
  );
  const signals = new Map(
    (await listSignalProvenance(workspaceId, signalIds)).map((s) => [s.id, s]),
  );
  const items = top.map((chunk) => {
    const signal = signals.get(chunk.sourceSignalIds[0] ?? "");
    return {
      id: chunk.id,
      plane: "B" as const,
      content: chunk.content,
      sourceUrl: signal?.sourceUrl ?? null,
      collectedAt: signal?.fetchedAt ?? chunk.createdAt,
      confidence: chunk.confidence,
      ...(input.newSince && chunk.createdAt > input.newSince ? { isNew: true } : {}),
    };
  });
  return { items, status: "matched" };
}

/**
 * Context recipe for task_type "campaign_plan". Two inputs: the feedback loop
 * (plans this workspace already ran and what the team recorded — plain SQL)
 * and the collected evidence (public-signal patterns relevant to the brief,
 * this workspace only, optionally one client's). Always context_available;
 * with neither it is a cold start with empty arrays, reported as such rather
 * than invented.
 */
export async function assemblePlanContext(
  params: PlanContextParams,
): Promise<ContextResult<PlanContext>> {
  const config = await getWorkspaceConfig(params.workspaceId);
  const scope = await resolveScope(params.workspaceId, params.brandId);
  const [worked, failed, retrieved] = await Promise.all([
    listPlanLessons(params.workspaceId, "worked", 3),
    listPlanLessons(params.workspaceId, "failed", 3),
    retrievePatternEvidence({
      workspaceId: params.workspaceId,
      brief: params.brief,
      floor: config?.similarityFloor ?? DEFAULT_SIMILARITY_FLOOR,
      scope,
      newSince: params.revisionOf?.createdAt ?? null,
    }),
  ]);

  const context: PlanContext = {
    brief: params.brief,
    worked: worked.map(toLesson),
    failed: failed.map(toLesson),
    patternEvidence: retrieved.items,
    baselineEvidence: [],
    coldStart: worked.length + failed.length + retrieved.items.length === 0,
    evidenceStatus: retrieved.status,
    scopeLabel: scope?.label ?? null,
    clientProfile: scope?.profile ?? null,
    anchor: params.anchor ?? null,
    revisionOf: params.revisionOf ?? null,
  };

  logContextAssembly({
    taskType: "campaign_plan",
    workspaceId: params.workspaceId,
    state: "context_available",
    sections: {
      workedLessons: context.worked.length,
      failedLessons: context.failed.length,
      patternEvidence: context.patternEvidence.length,
      baselineEvidence: context.baselineEvidence.length,
      coldStart: context.coldStart ? 1 : 0,
      scoped: scope ? 1 : 0,
      clientProfile: scope?.profile ? 1 : 0,
      revision: context.revisionOf ? 1 : 0,
    },
  });

  return { state: "context_available", context };
}
