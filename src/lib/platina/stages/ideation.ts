/**
 * ideation stage (core spine S5): Brain -> candidate directions, each citing
 * the Brain chunks it rests on. Pattern layer only (Plane B) — it never cites
 * first-party brand chunks, so a direction's "why" has one plane. Below the
 * evidence floor it says so instead of inventing a direction.
 */
import type { StageResult } from "../orchestrator";
import {
  parseCited,
  renderEvidence,
  toEvidence,
  type EvidenceRow,
  type StageFindingInput,
} from "./cited";

export const IDEATION_USE_CASE = "ideation";
/** Fewer validated Brain chunks than this is not enough to propose from. */
export const MIN_IDEATION_EVIDENCE = 3;

export type IdeationDeps = {
  loadBrain: (workspaceId: string) => Promise<EvidenceRow[]>;
  propose: (prompt: string) => Promise<string>;
  exists: (workspaceId: string, title: string) => Promise<boolean>;
  insertFinding: (input: StageFindingInput) => Promise<string>;
};

export function buildIdeationPrompt(brain: EvidenceRow[]): string {
  return [
    renderEvidence("Validated market patterns (public signals)", brain),
    "Propose up to 3 candidate campaign directions that these patterns support. Each must cite at least one id from the list above, exactly as written in brackets. Do not invent ids, budgets or results, and do not claim a direction will work — say what the evidence suggests.",
    'Reply with JSON only: {"items":[{"title":string,"summary":string,"severity":"low","brainChunkIds":string[]}]}. Use an empty items array if the patterns do not support a direction.',
  ].join("\n\n");
}

export async function runIdeationStage(
  deps: IdeationDeps,
  workspaceId: string,
): Promise<StageResult> {
  const brain = await deps.loadBrain(workspaceId);
  if (brain.length < MIN_IDEATION_EVIDENCE) {
    return {
      status: "skipped",
      reason: `needs ${MIN_IDEATION_EVIDENCE} validated patterns, has ${brain.length}`,
    };
  }
  const raw = await deps.propose(buildIdeationPrompt(brain));
  const { items, rejected } = parseCited(raw, {
    brand: new Set(),
    brain: new Set(brain.map((r) => r.id)),
    require: { brand: false, brain: true },
  });
  if (items.length === 0 && rejected > 0) {
    throw new Error(`${rejected} direction(s) rejected: uncited or unknown evidence ids`);
  }

  let produced = 0;
  for (const item of items) {
    if (await deps.exists(workspaceId, item.title)) continue;
    await deps.insertFinding({
      workspaceId,
      useCase: IDEATION_USE_CASE,
      title: item.title,
      summary: item.summary,
      severity: item.severity,
      evidence: { ...toEvidence(item), brandChunkIds: [] },
      status: "new",
    });
    produced += 1;
  }
  return {
    status: "done",
    produced,
    note:
      `${produced} new direction(s)` +
      (rejected > 0 ? `, ${rejected} rejected for missing citations` : ""),
  };
}
