import type { PlanOrigin } from "@/db/platina-schema";
import { insertPlan } from "@/db/queries/platina";
import {
  runOrchestration,
  type CriticVerdict,
  type OrchestrationResult,
} from "@/lib/orchestrator/run";
import {
  critiquePlan,
  generateCampaignPlan,
  validatePlan,
} from "@/lib/platina/plan/agent";
import {
  assemblePlanContext,
  type PlanContext,
  type PlanRevisionInput,
} from "@/lib/platina/plan/context";

export type PlanFlowOutput = {
  planId: string;
  /** Empty when the independent review passed the plan. */
  criticFeedback: string[];
};

export const REVIEW_UNAVAILABLE_FEEDBACK =
  "Independent review could not be completed; read this plan critically before using it.";

/**
 * Brief -> plan flow: assemble lessons (context) -> Planner proposes ->
 * validate -> independent review -> persist. The caller owns auth and the
 * cost-tracking context; the persist is the orchestrator's `apply`, so the
 * agent never touches the database. A failed review is surfaced as feedback,
 * never silently skipped.
 */
export function runPlanFlow(params: {
  workspaceId: string;
  brief: string;
  userId: string | null;
  /** The client this plan is for; scopes evidence to it and its competitors. */
  brandId?: string | null;
  /** The situation that started the plan, stored with it. */
  origin?: PlanOrigin | null;
  /** A fixed date (days from today) the plan must land on. */
  anchor?: { label: string; day: number } | null;
  /** Set when re-planning: the earlier plan and its id. */
  revision?: (PlanRevisionInput & { planId: string }) | null;
}): Promise<OrchestrationResult<PlanFlowOutput>> {
  return runOrchestration({
    taskType: "campaign_plan",
    contextParams: {
      workspaceId: params.workspaceId,
      brief: params.brief,
      brandId: params.brandId ?? null,
      anchor: params.anchor ?? null,
      revisionOf: params.revision ?? null,
    },
    assembleContext: assemblePlanContext,
    agent: (context) => generateCampaignPlan(context),
    validate: (plan, context) => validatePlan(plan, context),
    critic: async (plan, context: PlanContext): Promise<CriticVerdict> => {
      try {
        const critique = await critiquePlan(plan, context);
        return critique.verdict === "flagged" && critique.feedback.length > 0
          ? { verdict: "flagged", feedback: critique.feedback }
          : { verdict: "pass" };
      } catch {
        return { verdict: "flagged", feedback: [REVIEW_UNAVAILABLE_FEEDBACK] };
      }
    },
    apply: async (plan, context, critic) => {
      const criticFeedback =
        critic?.verdict === "flagged" ? critic.feedback : [];
      const planId = await insertPlan({
        workspaceId: params.workspaceId,
        title: plan.title,
        brief: params.brief,
        plan: plan.doc,
        critique: criticFeedback,
        lessonsUsed: context.worked.length + context.failed.length,
        createdById: params.userId,
        brandId: params.brandId ?? null,
        origin: params.origin ?? null,
        parentPlanId: params.revision?.planId ?? null,
      });
      return { planId, criticFeedback };
    },
  });
}
