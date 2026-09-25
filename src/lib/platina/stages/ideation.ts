/**
 * ideation stage (core spine S5): Brain -> candidate directions, each citing
 * the Brain chunks it rests on. Pattern layer only (Plane B) — it never cites
 * first-party brand chunks, so a direction's "why" has one plane. Below the
 * evidence floor it says so instead of inventing a direction.
 */
import type { StageResult } from "../orchestrator";
import {
  aliasRows,
  parseCited,
  renderEvidence,
  toEvidence,
  type EvidenceRow,
  type StageFindingInput,
} from "./cited";

export const IDEATION_USE_CASE = "ideation";
/** Fewer validated Brain chunks than this is not enough to propose from. */
export const MIN_IDEATION_EVIDENCE = 3;
/**
 * One round of directions per workspace per this many hours. Live 2026-09-23:
 * 18 conference runs in a row each re-proposed from the same Brain and left
 * 53 near-identical directions ("thought leadership at ASMS" eight times).
 */
export const IDEATION_COOLDOWN_HOURS = 6;
/** Two titles sharing this share of their meaningful words are the same direction. */
export const SAME_DIRECTION = 0.5;

export type IdeationDeps = {
  loadBrain: (workspaceId: string) => Promise<EvidenceRow[]>;
  propose: (prompt: string) => Promise<string>;
  exists: (workspaceId: string, title: string) => Promise<boolean>;
  insertFinding: (input: StageFindingInput) => Promise<string>;
  /** Open directions, newest first (cooldown and near-duplicates). Absent = no check. */
  openDirections?: (workspaceId: string) => Promise<{ title: string; createdAt: Date }[]>;
  now?: () => Date;
};

const FILLER = new Set(
  "a an and the of for to in on at with via by from upcoming campaign campaigns series launch leverage host plan develop create use using drive target targeted around aligned".split(" "),
);

function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !FILLER.has(w)),
  );
}

/** Jaccard overlap of meaningful title words: "same direction, new wording". */
export function sameDirection(a: string, b: string): boolean {
  const x = titleWords(a);
  const y = titleWords(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / (x.size + y.size - shared) >= SAME_DIRECTION;
}

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
  const open = deps.openDirections ? await deps.openDirections(workspaceId) : [];
  const now = deps.now?.() ?? new Date();
  const newest = open[0]?.createdAt;
  if (newest) {
    const hours = (now.getTime() - newest.getTime()) / 3_600_000;
    if (hours < IDEATION_COOLDOWN_HOURS) {
      return {
        status: "skipped",
        reason: `directions were proposed ${Math.max(0, Math.floor(hours))} h ago; next round after ${IDEATION_COOLDOWN_HOURS} h`,
      };
    }
  }

  const alias = aliasRows(brain, "P");
  const raw = await deps.propose(buildIdeationPrompt(alias.rows));
  const parsed = parseCited(raw, {
    brand: new Set(),
    brain: { has: (id) => alias.resolve(id) !== null },
    require: { brand: false, brain: true },
  });
  const rejected = parsed.rejected;
  // Labels back to real Brain chunk ids (deduplicated: P1 and its id are one).
  const items = parsed.items.map((item) => ({
    ...item,
    brainChunkIds: [...new Set(item.brainChunkIds.map((id) => alias.resolve(id) as string))],
  }));
  if (items.length === 0 && rejected > 0) {
    throw new Error(`${rejected} direction(s) rejected: uncited or unknown evidence ids`);
  }

  let produced = 0;
  for (const item of items) {
    if (await deps.exists(workspaceId, item.title)) continue;
    if (open.some((o) => sameDirection(o.title, item.title))) continue;
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
