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

/**
 * B8: how the evidence a plan cited has fared since, from the grader. A
 * refuted chunk outweighs any count of new signals: the plan rests on
 * something the results contradicted, so it is worth re-planning now.
 */
export type CitedVerdict = {
  id: string;
  verdict: "refuted" | "promoted";
  /** When the refuting grade was recorded; null when unknown (promoted rows). */
  at: Date | null;
  metric: string | null;
  measuredValue: number | null;
  threshold: number | null;
  direction: string | null;
};

export function levelWithVerdicts(newCount: number, verdicts: CitedVerdict[]): FreshnessLevel {
  return verdicts.some((v) => v.verdict === "refuted") ? "replan" : freshnessLevel(newCount);
}

/** Plain words for one verdict badge (plan §9 copy; no internal terms). */
export function verdictLabel(v: CitedVerdict): string {
  if (v.verdict === "promoted") return "Held up when tested";
  const date = v.at ? ` on ${v.at.toISOString().slice(0, 10)}` : "";
  if (v.measuredValue === null || v.threshold === null || !v.direction) return `Proved wrong${date}`;
  const round = (x: number) => Math.round(x * 100) / 100;
  return `Proved wrong${date}: measured ${round(v.measuredValue)}, ${v.direction} the ${round(v.threshold)} it was tested against`;
}

export function refutedMessage(count: number): string {
  return count === 1
    ? "Evidence behind this plan was proved wrong when its results came in. Worth re-planning."
    : `${count} pieces of evidence behind this plan were proved wrong when their results came in. Worth re-planning.`;
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
