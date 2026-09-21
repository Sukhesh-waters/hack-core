/**
 * brand_divergence stage (core spine S5): where does what competitors are now
 * saying pull away from the declared brand standard? Compares first-party
 * brand chunks against Brain chunks derived from public signals. Both sets are
 * cited by id in separate lists on the finding; nothing is stored uncited.
 *
 * Dependency-injected and DB-free so it is testable with fakes.
 */
import type { StageResult } from "../orchestrator";
import {
  parseCited,
  renderEvidence,
  toEvidence,
  type EvidenceRow,
  type StageFindingInput,
} from "./cited";

export const DIVERGENCE_USE_CASE = "brand_divergence";

export type DivergenceDeps = {
  loadBrand: (workspaceId: string) => Promise<EvidenceRow[]>;
  loadCompetitor: (workspaceId: string) => Promise<EvidenceRow[]>;
  /** The client this run is about, when its source is linked to one (R3). */
  clientName?: string | null;
  propose: (prompt: string) => Promise<string>;
  /** True when an open finding with this title already exists (runs repeat). */
  exists: (workspaceId: string, title: string) => Promise<boolean>;
  insertFinding: (input: StageFindingInput) => Promise<string>;
};

export function buildDivergencePrompt(
  brand: EvidenceRow[],
  competitor: EvidenceRow[],
): string {
  return [
    renderEvidence("Declared brand standard (our client, first-party)", brand),
    renderEvidence("What competitors are saying now (public signals)", competitor),
    "Find up to 3 places where competitor messaging pulls away from, contradicts, or crowds the declared brand standard. Each item must cite at least one brand id AND at least one competitor id from the lists above, using the ids exactly as written in brackets. Do not invent ids, numbers or results.",
    'Reply with JSON only: {"items":[{"title":string,"summary":string,"severity":"critical"|"high"|"medium"|"low","brandChunkIds":string[],"brainChunkIds":string[]}]}. Use an empty items array if nothing genuinely diverges.',
  ].join("\n\n");
}

export async function runDivergenceStage(
  deps: DivergenceDeps,
  workspaceId: string,
): Promise<StageResult> {
  const [brand, competitor] = await Promise.all([
    deps.loadBrand(workspaceId),
    deps.loadCompetitor(workspaceId),
  ]);
  if (brand.length === 0) {
    // Actionable, not a dead end: /start already produces a client profile,
    // and one confirmation turns it into the standard this stage needs (R3).
    return {
      status: "skipped",
      reason: deps.clientName
        ? `confirm how we describe ${deps.clientName} to turn this on`
        : "no declared brand standard yet — confirm a client profile to turn this on",
    };
  }
  if (competitor.length === 0) {
    return { status: "skipped", reason: "no validated competitor evidence yet" };
  }

  const raw = await deps.propose(buildDivergencePrompt(brand, competitor));
  const { items, rejected } = parseCited(raw, {
    brand: new Set(brand.map((r) => r.id)),
    brain: new Set(competitor.map((r) => r.id)),
    require: { brand: true, brain: true },
  });
  // Every item cited nothing real: that is a broken stage, not "no divergence".
  if (items.length === 0 && rejected > 0) {
    throw new Error(`${rejected} divergence(s) rejected: uncited or unknown evidence ids`);
  }

  let produced = 0;
  for (const item of items) {
    if (await deps.exists(workspaceId, item.title)) continue;
    await deps.insertFinding({
      workspaceId,
      useCase: DIVERGENCE_USE_CASE,
      title: item.title,
      summary: item.summary,
      severity: item.severity,
      evidence: toEvidence(item),
      status: "new",
    });
    produced += 1;
  }
  return {
    status: "done",
    produced,
    note:
      `${produced} new divergence(s)` +
      (rejected > 0 ? `, ${rejected} rejected for missing citations` : ""),
  };
}
