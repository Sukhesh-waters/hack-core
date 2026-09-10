import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Cost-attribution context: server actions wrap agent calls in
 * runWithAiCost so routeAI can log usage against the right workspace and
 * enforce its daily cap — no agent signature threading (Phase 5 plan §1).
 */

export type AiCostContext = { workspaceId: string; purpose?: string };

const storage = new AsyncLocalStorage<AiCostContext>();

export function runWithAiCost<T>(
  context: AiCostContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

/** undefined outside a context — such calls log as system (workspace null). */
export function currentAiCost(): AiCostContext | undefined {
  return storage.getStore();
}
