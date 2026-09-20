import { createIdeas } from "@/db/queries/ideas";
import {
  generateIdeas,
  markDeclaredOnly,
  type IdeaDraft,
} from "@/lib/ai/agents/strategy";
import {
  assembleIdeationContext,
  type IdeationContext,
  type IdeationContextParams,
} from "@/lib/ai/context/ideation";
import {
  runOrchestration,
  type OrchestrationResult,
  type ValidationResult,
} from "@/lib/orchestrator/run";

export type IdeationOutput = { count: number };

/**
 * Deterministic guard on the Strategy agent's proposal. The declared-only
 * rule is a constitution invariant (never invent post citations without a
 * baseline); markDeclaredOnly enforces it, this catches a future regression.
 */
export function validateIdeas(
  ideas: IdeaDraft[],
  context: IdeationContext,
): ValidationResult {
  if (ideas.length === 0) {
    return { valid: false, reason: "The agent returned no ideas." };
  }
  if (
    context.evidence.mode === "declared_only" &&
    ideas.some((idea) => idea.why.citations.length > 0)
  ) {
    return {
      valid: false,
      reason: "Declared-only ideas must not carry post citations.",
    };
  }
  return { valid: true };
}

/**
 * Ideation flow: assemble context (brand + goal + first-party drivers) ->
 * Strategy agent proposes -> validate -> apply (persist the ideas). The
 * caller owns auth and the cost-tracking context; this owns the write, so
 * the agent never touches the database. No Critic: it is mandatory only for
 * campaign strategy, so ideation does not pay for a second model call.
 */
export function runIdeationFlow(
  params: IdeationContextParams,
): Promise<OrchestrationResult<IdeationOutput>> {
  return runOrchestration({
    taskType: "ideation",
    contextParams: params,
    assembleContext: assembleIdeationContext,
    agent: async (ctx) => {
      const firstParty = ctx.evidence.mode === "first_party" ? ctx.evidence : null;
      const generated = await generateIdeas({
        topic: ctx.topic,
        identity: ctx.identity,
        brief: ctx.evidence.brief,
        drivers: firstParty?.drivers ?? [],
        citedPostIds: firstParty?.citedPostIds,
        goal: ctx.goal,
      });
      return ctx.evidence.mode === "declared_only"
        ? markDeclaredOnly(generated)
        : generated;
    },
    validate: validateIdeas,
    apply: async (ideas) => {
      await createIdeas(
        ideas.map((idea) => ({
          workspaceId: params.workspaceId,
          clientId: params.clientId,
          topic: params.topic,
          hook: idea.hook,
          angle: idea.angle,
          format: idea.format,
          whyReason: idea.why.reason,
          citations: idea.why.citations,
        })),
      );
      return { count: ideas.length };
    },
  });
}
