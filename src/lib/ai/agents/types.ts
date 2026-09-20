/**
 * Shared contract for every export in agents/strategy.ts, agents/content.ts,
 * and agents/critic.ts (backend-rev.md §4/§6): an agent receives context,
 * reasons via routeAI, and returns a proposal. It never writes to Postgres,
 * never calls another agent module, and never bypasses the model router.
 * The orchestrator (not the agent) decides whether a proposal is applied.
 */
export type AgentRole = "strategy" | "content" | "critic";
