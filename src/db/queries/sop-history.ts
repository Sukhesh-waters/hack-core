import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, sopRunSteps, sopRuns, users } from "@/db/schema";
import {
  calculateTemplateMetrics,
  MIN_SOP_SAMPLE_N,
  type TemplateMetricsRollup,
} from "@/lib/sop/metrics";

const RUN_HISTORY_LIMIT = 100;
const STEP_FETCH_LIMIT = 1000;
const TEMPLATE_LIMIT = 200;

/**
 * Fetch all runs that originated from a specific SOP template.
 * Scoped strictly by workspaceId and templateId.
 */
export function templateRunsQuery(
  workspaceId: string,
  templateId: string,
  limit: number = RUN_HISTORY_LIMIT,
) {
  return db
    .select({
      id: sopRuns.id,
      name: sopRuns.name,
      clientId: sopRuns.clientId,
      clientName: clients.name,
      startedById: sopRuns.startedById,
      startedByName: users.name,
      status: sopRuns.status,
      anchorDate: sopRuns.anchorDate,
      createdAt: sopRuns.createdAt,
      completedAt: sopRuns.completedAt,
    })
    .from(sopRuns)
    .leftJoin(clients, eq(sopRuns.clientId, clients.id))
    .leftJoin(users, eq(sopRuns.startedById, users.id))
    .where(
      and(
        eq(sopRuns.workspaceId, workspaceId),
        eq(sopRuns.templateId, templateId),
      ),
    )
    .orderBy(desc(sopRuns.createdAt))
    .limit(limit);
}

/**
 * Batch-fetch steps across multiple runs for bottleneck and duration calculation.
 */
export function templateRunStepsQuery(workspaceId: string, runIds: string[]) {
  return db
    .select({
      id: sopRunSteps.id,
      runId: sopRunSteps.runId,
      templateStepId: sopRunSteps.templateStepId,
      title: sopRunSteps.title,
      status: sopRunSteps.status,
      dueAt: sopRunSteps.dueAt,
      completedAt: sopRunSteps.completedAt,
      rejectionReason: sopRunSteps.rejectionReason,
      createdAt: sopRunSteps.createdAt,
    })
    .from(sopRunSteps)
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        inArray(sopRunSteps.runId, runIds.length > 0 ? runIds : ["__none__"]),
      ),
    )
    .orderBy(asc(sopRunSteps.position), asc(sopRunSteps.createdAt))
    .limit(STEP_FETCH_LIMIT);
}

/**
 * Counts of runs per template across the workspace.
 */
export function sopTemplateRunCountsQuery(workspaceId: string) {
  return db
    .select({
      templateId: sopRuns.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(sopRuns)
    .where(
      and(
        eq(sopRuns.workspaceId, workspaceId),
        isNotNull(sopRuns.templateId),
      ),
    )
    .groupBy(sopRuns.templateId)
    .limit(TEMPLATE_LIMIT);
}

export async function sopTemplateRunCounts(
  workspaceId: string,
): Promise<Map<string, number>> {
  const rows = await sopTemplateRunCountsQuery(workspaceId);
  return new Map(
    rows
      .filter((r): r is { templateId: string; count: number } => r.templateId !== null)
      .map((r) => [r.templateId, r.count]),
  );
}

/**
 * Pulls all runs and their step executions for a given template and returns
 * the rollup statistics, cycle times, bottleneck metrics, and run history.
 */
export async function getTemplateMetrics(
  workspaceId: string,
  templateId: string,
  minSampleN: number = MIN_SOP_SAMPLE_N,
): Promise<TemplateMetricsRollup> {
  const runs = await templateRunsQuery(workspaceId, templateId);

  if (runs.length === 0) {
    return calculateTemplateMetrics(templateId, [], minSampleN);
  }

  const runIds = runs.map((r) => r.id);
  const steps = await templateRunStepsQuery(workspaceId, runIds);

  const stepsByRunId = new Map<string, typeof steps>();
  for (const s of steps) {
    const arr = stepsByRunId.get(s.runId);
    if (arr) {
      arr.push(s);
    } else {
      stepsByRunId.set(s.runId, [s]);
    }
  }

  const runsWithSteps = runs.map((r) => ({
    ...r,
    steps: stepsByRunId.get(r.id) ?? [],
  }));

  return calculateTemplateMetrics(templateId, runsWithSteps, minSampleN);
}
