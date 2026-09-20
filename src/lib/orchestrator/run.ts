import type { ContextResult, ContextState } from "@/lib/ai/context/types";

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export type CriticVerdict =
  | { verdict: "pass" }
  | { verdict: "flagged"; feedback: string[] };

export type OrchestrationResult<TOutput> =
  | { status: "insufficient_context"; state: ContextState }
  | { status: "invalid_proposal"; reason: string }
  | { status: "completed"; output: TOutput; critic?: CriticVerdict };

/**
 * Orchestrator (backend-rev.md §7): Trigger -> Route -> Context Recipe ->
 * Context Assembly -> Agent -> Deterministic Validation -> Critic (when
 * required) -> Apply -> State Update -> Output. Agents propose; this
 * function is the only thing that decides whether a proposal gets applied
 * and calls `apply`.
 *
 * Routing is the caller choosing which taskType/recipe/agent/critic/apply
 * set to pass in — that decision already happens deterministically at the
 * Next.js server-action layer, so there is no separate routing step here.
 *
 * This is a plain async function, not a job platform: it runs one
 * synchronous propose-then-apply pass and returns. Background/scheduled
 * work still goes through Inngest (src/inngest/functions/*); this does not
 * replace it and carries no idempotency-key/retry machinery of its own —
 * add that at the call site only for a workflow that is actually async.
 */
export async function runOrchestration<TParams, TContext, TProposal, TOutput>(input: {
  taskType: string;
  contextParams: TParams;
  assembleContext: (params: TParams) => Promise<ContextResult<TContext>>;
  agent: (context: TContext) => Promise<TProposal>;
  validate: (proposal: TProposal) => ValidationResult;
  /** Independent challenge pass. Omit only for tasks with no critic wired yet. */
  critic?: (proposal: TProposal, context: TContext) => Promise<CriticVerdict>;
  apply: (
    proposal: TProposal,
    context: TContext,
    critic?: CriticVerdict,
  ) => Promise<TOutput>;
}): Promise<OrchestrationResult<TOutput>> {
  const assembled = await input.assembleContext(input.contextParams);
  if (assembled.state !== "context_available") {
    return { status: "insufficient_context", state: assembled.state };
  }

  const proposal = await input.agent(assembled.context);

  const validation = input.validate(proposal);
  if (!validation.valid) {
    return { status: "invalid_proposal", reason: validation.reason };
  }

  const critic = input.critic
    ? await input.critic(proposal, assembled.context)
    : undefined;

  const output = await input.apply(proposal, assembled.context, critic);
  return { status: "completed", output, critic };
}
