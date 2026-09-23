import type { PlatinaAlertAction, PlatinaAlertCondition } from "@/db/platina-schema";

export type AlertEvaluation = {
  matched: boolean;
  severity?: "info" | "warning" | "critical";
  actions: PlatinaAlertAction[];
};

export function matchCondition(
  record: Record<string, number | string>,
  condition: PlatinaAlertCondition,
): boolean {
  const actual = record[condition.field];
  if (actual === undefined) return false;
  const expected = condition.value;
  switch (condition.op) {
    case "eq":
      return actual === expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
  }
}

export function evaluateAlert(input: {
  record: Record<string, number | string>;
  conditions: PlatinaAlertCondition[];
  severity: "info" | "warning" | "critical";
  actions: PlatinaAlertAction[];
  sampleSize: number;
  minN: number;
}): AlertEvaluation {
  if (input.sampleSize < input.minN) {
    return { matched: false, actions: [] };
  }
  const matched = input.conditions.every((c) => matchCondition(input.record, c));
  if (!matched) return { matched: false, actions: [] };
  return { matched: true, severity: input.severity, actions: input.actions };
}

/**
 * The record each alert source evaluates (Slice 14). Outcome rules read the
 * latest first-party outcome; the operational sources read live queue counts.
 * Min-N applies to outcome metrics only — queue counts are operational
 * facts, not samples.
 */
export type AlertSource = "outcome" | "finding" | "approval" | "run" | "ops";

export const ALERT_SOURCE_FIELDS: Record<AlertSource, string[]> = {
  outcome: [
    "leads",
    "qualifiedLeads",
    "conversionRate",
    "pipelineContribution",
    "qualityScore",
  ],
  finding: ["openDecisions"],
  approval: ["pendingReceipts", "draftSolutions"],
  run: ["failedRuns"],
  // C7.1: how many ops-board checks are red / amber in the latest run.
  ops: ["redChecks", "amberChecks"],
};

export function isAlertSource(value: string): value is AlertSource {
  return value in ALERT_SOURCE_FIELDS;
}

/** One delivery per rule per 24 h — a repeat inside the window is recorded
 *  as suppressed with the reason, never silently dropped. */
export const DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function deliveryDecision(
  lastDeliveredAt: Date | string | null,
  now = new Date(),
): "send" | "suppress" {
  if (!lastDeliveredAt) return "send";
  const last =
    lastDeliveredAt instanceof Date
      ? lastDeliveredAt
      : new Date(lastDeliveredAt);
  return now.getTime() - last.getTime() < DELIVERY_WINDOW_MS
    ? "suppress"
    : "send";
}
