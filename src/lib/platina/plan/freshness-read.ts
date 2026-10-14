/**
 * Reads what changed since a plan was written (real-time planning). IO lives
 * here; the thresholds and wording are in freshness.ts. Cheap by design — no
 * model call — because the page re-renders on every live signal.
 */
import {
  listBrainEvidenceSince,
  listSignalProvenance,
} from "@/db/queries/platina";
import { listCitedEvidenceVerdicts } from "@/db/queries/platina-grades";
import { resolveScope } from "./context";
import { filterByScope, levelWithVerdicts, type CitedVerdict, type FreshnessLevel } from "./freshness";

export type PlanFreshness = {
  count: number;
  level: FreshnessLevel;
  /** B8: cited evidence the grader has since refuted or promoted. */
  verdicts: CitedVerdict[];
  scopeLabel: string | null;
  sample: {
    id: string;
    content: string;
    sourceUrl: string | null;
    collectedAt: Date;
  }[];
};

const SAMPLE = 4;

export async function readPlanFreshness(plan: {
  workspaceId: string;
  brandId: string | null;
  createdAt: Date;
  /** Ids from the plan's evidence snapshot; their verdicts escalate the level. */
  evidenceIds?: string[];
}): Promise<PlanFreshness> {
  const [scope, since, verdictRows] = await Promise.all([
    resolveScope(plan.workspaceId, plan.brandId),
    listBrainEvidenceSince(plan.workspaceId, plan.createdAt, 100),
    // A grades table that is not there yet (migration pending) must cost the
    // badges, not the page.
    listCitedEvidenceVerdicts(plan.workspaceId, plan.evidenceIds ?? []).catch(() => []),
  ]);
  const verdicts: CitedVerdict[] = verdictRows.map((r) => ({
    id: r.id,
    verdict: r.gradeState === "refuted" ? "refuted" : "promoted",
    at: r.gradedAt ?? null,
    metric: r.metric ?? null,
    measuredValue: r.measuredValue ?? null,
    threshold: r.threshold ?? null,
    direction: r.direction ?? null,
  }));
  const fresh = filterByScope(since, scope?.signalIds ?? null);
  const top = fresh.slice(0, SAMPLE);
  const provenance = new Map(
    (
      await listSignalProvenance(
        plan.workspaceId,
        Array.from(new Set(top.flatMap((c) => c.sourceSignalIds.slice(0, 1)))),
      )
    ).map((s) => [s.id, s]),
  );
  return {
    count: fresh.length,
    level: levelWithVerdicts(fresh.length, verdicts),
    verdicts,
    scopeLabel: scope?.label ?? null,
    sample: top.map((c) => ({
      id: c.id,
      content: c.content,
      sourceUrl: provenance.get(c.sourceSignalIds[0] ?? "")?.sourceUrl ?? null,
      collectedAt: provenance.get(c.sourceSignalIds[0] ?? "")?.fetchedAt ?? c.createdAt,
    })),
  };
}
