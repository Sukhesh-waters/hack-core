/**
 * Context Layer (backend-rev.md §3): task_type -> recipe -> structured +
 * semantic retrieval -> assembled context. Deterministic retrieval/assembly
 * logic, not a reasoning agent — recipes never let an LLM choose what to
 * query. Every recipe's `assemble` call must be traceable (logContextAssembly)
 * so a developer can see exactly what an agent run saw.
 *
 * States: context_available; insufficient_baseline (below the min-N gate);
 * insufficient_relevance (retrieval found nothing usable);
 * missing_context (a required input, e.g. brand DNA, does not exist yet).
 * retrieval.ts's DriverBrief predates this and keeps its own
 * "ready"/"insufficient_baseline" union — do not rename it.
 */
export type ContextState =
  | "context_available"
  | "insufficient_baseline"
  | "insufficient_relevance"
  | "missing_context";

export type ContextResult<T> =
  | { state: "context_available"; context: T }
  | { state: "insufficient_baseline"; sampleSize: number }
  | { state: "insufficient_relevance" }
  | { state: "missing_context"; reason: string };

export type ContextRecipe<TParams, TContext> = {
  taskType: string;
  assemble(params: TParams): Promise<ContextResult<TContext>>;
};

/**
 * Minimum traceability requirement: log what a recipe actually assembled
 * (never the raw content — just shape/counts) so a run's context is
 * reconstructable from logs without a new persistence layer.
 */
export function logContextAssembly(entry: {
  taskType: string;
  workspaceId: string;
  state: ContextState;
  sections: Record<string, number>;
}): void {
  console.info("[context]", JSON.stringify(entry));
}
