export type AutomationLedgerEntry = {
  ruleId: string;
  targetId: string;
  firedAt: Date;
};

/**
 * Generates a window key (e.g. "2026-08-18" or "2026-08-18:14" for hourly)
 */
export function formatWindowKey(date: Date, granularity: "daily" | "hourly" = "daily"): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (granularity === "daily") {
    return `${year}-${month}-${day}`;
  }
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day}:${hour}`;
}

/**
 * Checks whether an automation rule has already fired for a specific target
 * within the specified deduplication window (in hours).
 */
export function isDuplicateAutomationExecution(
  ledger: AutomationLedgerEntry[],
  ruleId: string,
  targetId: string,
  now: Date,
  windowHours = 24,
): boolean {
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;

  return ledger.some(
    (entry) =>
      entry.ruleId === ruleId &&
      entry.targetId === targetId &&
      entry.firedAt.getTime() >= cutoff,
  );
}

/**
 * Filters out items from candidate target IDs that have already been acted upon
 * by this rule within the deduplication window.
 */
export function filterDeduplicatedTargets(
  candidateTargetIds: string[],
  ruleId: string,
  ledger: AutomationLedgerEntry[],
  now: Date,
  windowHours = 24,
): string[] {
  return candidateTargetIds.filter(
    (targetId) =>
      !isDuplicateAutomationExecution(ledger, ruleId, targetId, now, windowHours),
  );
}
