import { assembleCampaignStrategyContext } from "@/lib/ai/context/campaign-strategy";

/**
 * task_type -> recipe registry (backend-rev.md §3). The orchestrator looks
 * up a recipe by task_type; it never lets an agent decide what to query.
 * Add a new key here, plus its own module under context/, per task_type —
 * do not grow this into a generic "query anything" abstraction.
 */
export const CONTEXT_RECIPES = {
  campaign_strategy: assembleCampaignStrategyContext,
} as const;

export type ContextTaskType = keyof typeof CONTEXT_RECIPES;
