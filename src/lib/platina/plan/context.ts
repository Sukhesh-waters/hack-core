import type { PlanDoc } from "@/db/platina-schema";
import { listPlanLessons } from "@/db/queries/platina";
import { logContextAssembly, type ContextResult } from "@/lib/ai/context/types";

export type PlanLesson = {
  title: string;
  brief: string;
  /** The past plan's summary plus the channels it used. */
  summary: string;
  /** What the team recorded about how it went. */
  note: string | null;
};

export type PlanContextParams = { workspaceId: string; brief: string };

export type PlanContext = {
  brief: string;
  worked: PlanLesson[];
  failed: PlanLesson[];
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

/**
 * Context recipe for task_type "campaign_plan". The feedback loop: plans this
 * workspace already ran and what the team recorded about them (worked /
 * failed). Plain SQL over this workspace's own rows: no retrieval, no
 * embeddings, nothing crosses workspaces. Always context_available; with no
 * logged results yet it is simply a cold start with empty lessons, reported
 * as such rather than invented.
 */
export async function assemblePlanContext(
  params: PlanContextParams,
): Promise<ContextResult<PlanContext>> {
  const [worked, failed] = await Promise.all([
    listPlanLessons(params.workspaceId, "worked", 3),
    listPlanLessons(params.workspaceId, "failed", 3),
  ]);

  const context: PlanContext = {
    brief: params.brief,
    worked: worked.map(toLesson),
    failed: failed.map(toLesson),
  };

  logContextAssembly({
    taskType: "campaign_plan",
    workspaceId: params.workspaceId,
    state: "context_available",
    sections: {
      workedLessons: context.worked.length,
      failedLessons: context.failed.length,
    },
  });

  return { state: "context_available", context };
}
