import { describe, expect, it } from "vitest";
import {
  DELIVERY_WINDOW_MS,
  deliveryDecision,
  evaluateAlert,
  matchCondition,
} from "./alerts";

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

describe("deliveryDecision", () => {
  it("sends when the rule has never delivered", () => {
    expect(deliveryDecision(null)).toBe("send");
  });

  it("suppresses a repeat inside the 24h window", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const recent = new Date(now.getTime() - DELIVERY_WINDOW_MS + 60_000);
    expect(deliveryDecision(recent, now)).toBe("suppress");
  });

  it("sends again after the window", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const old = new Date(now.getTime() - DELIVERY_WINDOW_MS - 60_000);
    expect(deliveryDecision(old, now)).toBe("send");
  });

  it("accepts serialized dates (Inngest step boundary)", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    expect(deliveryDecision("2026-09-17T11:00:00Z", now)).toBe("suppress");
  });
});
