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
}): Promise<OrchestrationResult<PlanFlowOutput>> {
  return runOrchestration({
    taskType: "campaign_plan",
    contextParams: { workspaceId: params.workspaceId, brief: params.brief },
    assembleContext: assemblePlanContext,
    agent: (context) => generateCampaignPlan(context),
    validate: (plan) => validatePlan(plan),
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
      });
      return { planId, criticFeedback };
    },
  });
}
