/**
 * WTR-0 Part B: classifies how a collection run was started for study measure
 * L2 ("routine work runs through the product, not operator scripts"). Pure.
 *
 * Every script under `scripts/` that calls `createAuditRun` stamps its path on
 * `configSnapshot.operator` (enforced by `run-origin.test.ts`). Runs created
 * before this slice have no `operator` field: unambiguous idempotency-key
 * prefixes (`seed:`, `ads:operator:`, `backfill:` vs `manual:`, `ads:manual:`,
 * `add:`) are classified, and anything ambiguous from before is returned as
 * `"unknown"` ("person or script, unknown") — never guessed as a person.
 */
import type { PlatinaRunConfigSnapshot } from "@/db/platina-schema";

export type RunOrigin = "schedule" | "event" | "person" | "operator" | "unknown";

export type RunOriginInput = {
  trigger: "manual" | "schedule" | "event";
  idempotencyKey: string;
  configSnapshot?: Pick<PlatinaRunConfigSnapshot, "operator"> | null;
  createdAt?: Date | null;
};

const OPERATOR_PREFIXES = ["seed:", "ads:operator:", "backfill:"];
const PERSON_PREFIXES = ["manual:", "ads:manual:", "add:"];

export function runOrigin(
  run: RunOriginInput,
  options: { markedSince?: Date } = {},
): RunOrigin {
  if (run.configSnapshot?.operator) return "operator";
  const key = run.idempotencyKey ?? "";
  if (OPERATOR_PREFIXES.some((p) => key.startsWith(p))) return "operator";
  if (run.trigger === "schedule" || key.startsWith("schedule:") || key.startsWith("cap-pause:")) {
    return "schedule";
  }
  if (PERSON_PREFIXES.some((p) => key.startsWith(p))) return "person";
  if (
    options.markedSince &&
    run.createdAt &&
    run.createdAt.getTime() >= options.markedSince.getTime()
  ) {
    return run.trigger === "manual" ? "person" : "event";
  }
  return "unknown";
}

export const RUN_ORIGIN_LABELS: Record<RunOrigin, string> = {
  schedule: "Scheduled",
  event: "Product event",
  person: "Person in the app",
  operator: "Operator script",
  unknown: "Person or script (unknown)",
};
