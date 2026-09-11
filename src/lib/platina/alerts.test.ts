import { describe, expect, it } from "vitest";
import { evaluateAlert, matchCondition } from "./alerts";

describe("alert rules", () => {
  it("composes AND conditions from any field", () => {
    expect(
      matchCondition({ conversionRate: 0.05 }, { field: "conversionRate", op: "lt", value: 0.1 }),
    ).toBe(true);
    const result = evaluateAlert({
      record: { conversionRate: 0.04, leads: 80 },
      conditions: [
        { field: "conversionRate", op: "lt", value: 0.1 },
        { field: "leads", op: "gte", value: 50 },
      ],
      severity: "critical",
      actions: [
        { kind: "hub_message", body: "quality drop" },
        { kind: "ticket", body: "investigate" },
      ],
      sampleSize: 20,
      minN: 20,
    });
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("critical");
    expect(result.actions).toHaveLength(2);
  });

  it("suppresses below min-N", () => {
    const result = evaluateAlert({
      record: { conversionRate: 0.01 },
      conditions: [{ field: "conversionRate", op: "lt", value: 0.1 }],
      severity: "warning",
      actions: [{ kind: "hub_message" }],
      sampleSize: 3,
      minN: 20,
    });
    expect(result.matched).toBe(false);
  });
});
