/**
 * Production wiring for the analysis stages: real queries and the model
 * router behind the DB-free stage functions. Kept out of divergence.ts and
 * ideation.ts so those stay testable with plain fakes.
 *
 * R3: every read is scoped to one client when the run has one. A workspace
 * holding two clients must never compare client A's declared standard with
 * client B's competitors — isolation holds either way, but the comparison is
 * meaningless, and it gets worse with every client added.
 */
import {
  findingTitleExists,
  openFindingsForUseCaseQuery,
  getBrand,
  insertFinding,
  listCompetitorsOf,
  listRecentBrainEvidence,
  listRecentBrandEvidence,
  listSignalIdsForBrands,
} from "@/db/queries/platina";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import type { StageResult } from "../orchestrator";
import type { EvidenceRow } from "./cited";
import {
  DIVERGENCE_USE_CASE,
  runDivergenceStage,
  type DivergenceDeps,
} from "./divergence";
import {
  IDEATION_USE_CASE,
  runIdeationStage,
  type IdeationDeps,
} from "./ideation";
import { chunksForScope } from "./scope";

const EVIDENCE_TAKE = 10;
/** A scoped read filters after the fact, so it looks at a wider pool first. */
const SCOPED_POOL = 60;

const asRows = (rows: { id: string; content: string }[]): EvidenceRow[] =>
  rows.map((r) => ({ id: r.id, content: r.content }));

const propose = (system: string) => (prompt: string) =>
  routeAI({ kind: "chat", tier: "quality", json: true, system, prompt });

/** The client (and its competitors) a run is about. Null = whole workspace. */
export type StageScope = {
  brandId: string;
  clientName: string | null;
  /** Signal ids belonging to the client and its competitors. */
  signalIds: Set<string>;
} | null;

/**
 * Resolves the run's brand into a scope. A competitor's own brandId resolves
 * to its parent client, so a competitor-triggered run still compares against
 * the right standard.
 */
export async function resolveStageScope(
  workspaceId: string,
  brandId: string | null | undefined,
): Promise<StageScope> {
  if (!brandId) return null;
  const brand = await getBrand(workspaceId, brandId);
  if (!brand) return null;
  const client =
    brand.kind === "own_brand"
      ? brand
      : brand.parentBrandId
        ? await getBrand(workspaceId, brand.parentBrandId)
        : null;
  if (!client) {
    // An unparented competitor: scope to that competitor's own signals only,
    // rather than silently widening to the whole workspace.
    const ids = await listSignalIdsForBrands(workspaceId, [brand.id]);
    return { brandId: brand.id, clientName: null, signalIds: new Set(ids) };
  }
  const competitors = await listCompetitorsOf(workspaceId, client.id);
  const ids = await listSignalIdsForBrands(workspaceId, [
    client.id,
    ...competitors.map((c) => c.id),
  ]);
  return { brandId: client.id, clientName: client.name, signalIds: new Set(ids) };
}

/** Brain chunks that rest on this client's own collected signals. */
async function scopedBrain(
  workspaceId: string,
  scope: StageScope,
): Promise<EvidenceRow[]> {
  if (!scope) return asRows(await listRecentBrainEvidence(workspaceId, EVIDENCE_TAKE));
  const pool = await listRecentBrainEvidence(workspaceId, SCOPED_POOL);
  return asRows(chunksForScope(pool, scope.signalIds, EVIDENCE_TAKE));
}

function divergenceDeps(scope: StageScope): DivergenceDeps {
  return {
    clientName: scope?.clientName ?? null,
    loadBrand: async (ws) =>
      asRows(await listRecentBrandEvidence(ws, EVIDENCE_TAKE, scope?.brandId ?? null)),
    loadCompetitor: (ws) => scopedBrain(ws, scope),
    propose: propose(
      "You compare a client's declared brand standard with what competitors now say. Cite evidence ids exactly. Never invent evidence.",
    ),
    exists: (ws, title) => findingTitleExists(ws, DIVERGENCE_USE_CASE, title),
    insertFinding,
  };
}

function ideationDeps(scope: StageScope): IdeationDeps {
  return {
    loadBrain: (ws) => scopedBrain(ws, scope),
    propose: propose(
      "You propose campaign directions strictly from validated market patterns. Cite evidence ids exactly. Never invent evidence.",
    ),
    exists: (ws, title) => findingTitleExists(ws, IDEATION_USE_CASE, title),
    insertFinding,
    openDirections: (ws) => openFindingsForUseCaseQuery(ws, IDEATION_USE_CASE),
  };
}

// Each stage runs inside a cost context so the daily AI cap applies and its
// provider failures are attributed to the workspace.
export const divergenceStage = (
  ws: string,
  brandId?: string | null,
): Promise<StageResult> =>
  runWithAiCost({ workspaceId: ws, purpose: "brand-divergence" }, async () =>
    runDivergenceStage(divergenceDeps(await resolveStageScope(ws, brandId)), ws),
  );

export const ideationStage = (
  ws: string,
  brandId?: string | null,
): Promise<StageResult> =>
  runWithAiCost({ workspaceId: ws, purpose: "ideation" }, async () =>
    runIdeationStage(ideationDeps(await resolveStageScope(ws, brandId)), ws),
  );
