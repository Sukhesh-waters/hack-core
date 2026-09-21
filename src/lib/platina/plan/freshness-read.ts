/**
 * Reads what changed since a plan was written (real-time planning). IO lives
 * here; the thresholds and wording are in freshness.ts. Cheap by design — no
 * model call — because the page re-renders on every live signal.
 */
import {
  listBrainEvidenceSince,
  listSignalProvenance,
} from "@/db/queries/platina";
import { resolveScope } from "./context";
import { filterByScope, freshnessLevel, type FreshnessLevel } from "./freshness";

export type PlanFreshness = {
  count: number;
  level: FreshnessLevel;
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
}): Promise<PlanFreshness> {
  const [scope, since] = await Promise.all([
    resolveScope(plan.workspaceId, plan.brandId),
    listBrainEvidenceSince(plan.workspaceId, plan.createdAt, 100),
  ]);
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
    level: freshnessLevel(fresh.length),
    scopeLabel: scope?.label ?? null,
    sample: top.map((c) => ({
      id: c.id,
      content: c.content,
      sourceUrl: provenance.get(c.sourceSignalIds[0] ?? "")?.sourceUrl ?? null,
      collectedAt: provenance.get(c.sourceSignalIds[0] ?? "")?.fetchedAt ?? c.createdAt,
    })),
  };
}
