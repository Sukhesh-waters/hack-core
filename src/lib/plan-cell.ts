/**
 * Which columns the S2 plan grid may write.
 *
 * The exclusions matter more than the inclusions. status, complianceStatus
 * and productionStage are workflow state, not data: they are moved by the
 * approval gate (approvals/actions.ts) and the stage transition graph
 * (src/lib/production.ts), each of which enforces rules a spreadsheet cell
 * cannot. Making them editable in the grid would let anyone type a card
 * straight to "approved" and out to a client, skipping compliance.
 *
 * They render in the grid as read-only badges. This list is the enforcement
 * point, kept out of the server action so it can be asserted directly.
 */
export const PLAN_CELL_FIELDS = [
  "type",
  "durationSec",
  "pillar",
  "strategyNote",
  "title",
  "assigneeId",
  "dueAt",
  "scheduledFor",
] as const;

export type PlanCellField = (typeof PLAN_CELL_FIELDS)[number];

/** Workflow state — never writable from the grid. Named explicitly so a
 *  future edit that adds one to PLAN_CELL_FIELDS fails a test, not review. */
export const READ_ONLY_PLAN_FIELDS = [
  "status",
  "complianceStatus",
  "productionStage",
] as const;

export function isEditablePlanField(field: string): field is PlanCellField {
  return (PLAN_CELL_FIELDS as readonly string[]).includes(field);
}

/**
 * The shape a revision stores (S4). Dates are ISO strings, not Date objects:
 * these land in jsonb, which has no date type, and a Date would round-trip
 * back as a string anyway — better to be honest about it in the type than to
 * lie and cast at every read.
 */
export type PlanEditableFields = {
  type: string;
  durationSec: number | null;
  pillar: string | null;
  strategyNote: string | null;
  title: string;
  assigneeId: string | null;
  dueAt: string | null;
  scheduledFor: string | null;
};
