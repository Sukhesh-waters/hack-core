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
