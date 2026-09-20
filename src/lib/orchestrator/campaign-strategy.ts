import { critiqueCampaignStrategy } from "@/lib/ai/agents/critic";
import {
  generateCampaignStrategy,
  type CampaignStrategy,
} from "@/lib/ai/agents/strategy";
import {
  assembleCampaignStrategyContext,
  type CampaignStrategyContextParams,
} from "@/lib/ai/context/campaign-strategy";
import {
  runOrchestration,
  type CriticVerdict,
  type OrchestrationResult,
  type ValidationResult,
} from "@/lib/orchestrator/run";

export type CampaignStrategyOutput = {
  strategy: CampaignStrategy;
  /** Empty when the critic passed the strategy. */
  criticFeedback: string[];
};

/** Cross-field invariants the zod schema cannot express. */
export function validateCampaignStrategy(
  strategy: CampaignStrategy,
): ValidationResult {
  const { min, max } = strategy.recommendedBudgetRange;
  if (min > max) {
    return {
      valid: false,
      reason: `Budget range is inverted ($${min} is above $${max}).`,
    };
  }
  return { valid: true };
}

export const CRITIC_UNAVAILABLE_FEEDBACK =
  "Independent review could not be completed — review this strategy manually before using it.";

/**
 * Propose-only flow: assembles context, has the Strategy agent propose,
 * validates, and runs the mandatory Critic pass. Nothing is persisted here —
 * the campaign row + Hub approval are written later by the explicit
 * createCampaignWithApproval submit, after a human reviews the proposal.
 */
export function runCampaignStrategy(
  params: CampaignStrategyContextParams,
): Promise<OrchestrationResult<CampaignStrategyOutput>> {
  return runOrchestration({
    taskType: "campaign_strategy",
    contextParams: params,
    assembleContext: assembleCampaignStrategyContext,
    agent: (ctx) =>
      generateCampaignStrategy(ctx.brand, ctx.market, ctx.selectedContent),
    validate: validateCampaignStrategy,
    critic: async (strategy, ctx): Promise<CriticVerdict> => {
      try {
        const critique = await critiqueCampaignStrategy(
          strategy,
          ctx.brand,
          ctx.market,
        );
        return critique.verdict === "flagged" && critique.feedback.length > 0
          ? { verdict: "flagged", feedback: critique.feedback }
          : { verdict: "pass" };
      } catch {
        // Mandatory means visible: a failed review is surfaced, never skipped.
        return { verdict: "flagged", feedback: [CRITIC_UNAVAILABLE_FEEDBACK] };
      }
    },
    apply: async (strategy, _ctx, critic) => ({
      strategy,
      criticFeedback: critic?.verdict === "flagged" ? critic.feedback : [],
    }),
  });
}
