import { describe, expect, it } from "vitest";
import {
  isEditablePlanField,
  PLAN_CELL_FIELDS,
  READ_ONLY_PLAN_FIELDS,
} from "./plan-cell";

/**
 * The single most important constraint in the plan grid: workflow state is
 * not data. If any of these ever became editable from a cell, a card could
 * be typed straight past compliance and the approval gate.
 */
describe("plan grid field allowlist", () => {
  it("rejects every workflow-state field", () => {
    for (const field of READ_ONLY_PLAN_FIELDS) {
      expect(isEditablePlanField(field), `${field} must stay read-only`).toBe(
        false,
      );
    }
  });

  it("rejects status specifically — it must not be reachable", () => {
    expect(isEditablePlanField("status")).toBe(false);
  });

  it("keeps workflow fields out of the editable list entirely", () => {
    for (const field of READ_ONLY_PLAN_FIELDS) {
      expect(PLAN_CELL_FIELDS).not.toContain(field);
    }
  });

  it("accepts the planning fields the grid owns", () => {
    for (const field of [
      "type",
      "durationSec",
      "pillar",
      "strategyNote",
      "title",
      "assigneeId",
      "dueAt",
      "scheduledFor",
    ]) {
      expect(isEditablePlanField(field), `${field} should be editable`).toBe(
        true,
      );
    }
  });

  it("rejects unknown and injected field names", () => {
    for (const field of ["", "workspaceId", "id", "body", "__proto__"]) {
      expect(isEditablePlanField(field)).toBe(false);
    }
  });
});
