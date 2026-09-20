/**
 * Shared contract for every export in agents/strategy.ts, agents/content.ts,
 * and agents/critic.ts (backend-rev.md §4/§6): an agent receives context,
 * reasons via routeAI, and returns a proposal. It never writes to Postgres,
 * never calls another agent module, and never bypasses the model router.
 * The orchestrator (not the agent) decides whether a proposal is applied.
 */
export type AgentRole = "strategy" | "content" | "critic";

/**
 * Context-assembly outcome vocabulary (backend-rev.md §3). retrieval.ts's
 * DriverBrief predates this and keeps its own "ready"/"insufficient_baseline"
 * union — do not rename it. New Context Layer recipes should use this one.
 */
export type ContextState =
  | "context_available"
  | "insufficient_baseline"
  | "insufficient_relevance";
