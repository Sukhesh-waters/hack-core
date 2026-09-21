/**
 * Plan freshness (real-time planning): how much validated evidence has arrived
 * since a plan was written. Scope-based, not relevance-ranked, and labelled as
 * such — the honest claim is "new validated signals for this client", never
 * "this changes your plan". The decision to re-plan stays with the team.
 * Pure shaping here; the reads are in the query layer.
 */

export type FreshnessLevel = "current" | "review" | "replan";

export type FreshnessEvidence = {
  id: string;
  content: string;
  createdAt: Date;
  sourceSignalIds: string[];
};

/** Keeps chunks that came from the given signals; everything when unscoped. */
export function filterByScope<T extends { sourceSignalIds: string[] }>(
  chunks: T[],
  scopeSignalIds: Set<string> | null,
): T[] {
  if (!scopeSignalIds) return chunks;
  return chunks.filter((c) => c.sourceSignalIds.some((id) => scopeSignalIds.has(id)));
}

/** A handful of new signals is worth a look; several is worth a re-plan. */
export const REPLAN_THRESHOLD = 3;

export function freshnessLevel(newCount: number): FreshnessLevel {
  if (newCount <= 0) return "current";
  return newCount >= REPLAN_THRESHOLD ? "replan" : "review";
}

export function freshnessMessage(newCount: number, scopeLabel: string | null): string {
  const where = scopeLabel ? `for ${scopeLabel}` : "in this workspace";
  switch (freshnessLevel(newCount)) {
    case "current":
      return `Up to date: no new validated signals ${where} since this plan was written.`;
    case "review":
      return `${newCount} new validated signal${newCount === 1 ? "" : "s"} ${where} since this plan was written. Worth a look.`;
    case "replan":
      return `${newCount} new validated signals ${where} since this plan was written. Worth re-planning.`;
  }
}
