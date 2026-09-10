import { describe, expect, it } from "vitest";
import {
  filterDeduplicatedTargets,
  formatWindowKey,
  isDuplicateAutomationExecution,
} from "./automation-ledger";

describe("automation-ledger", () => {
  it("formats daily and hourly window keys", () => {
    const d = new Date("2026-08-18T14:30:00Z");
    expect(formatWindowKey(d, "daily")).toBe("2026-08-18");
    expect(formatWindowKey(d, "hourly")).toBe("2026-08-18:14");
  });

  it("identifies duplicate executions within window", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const fourHoursAgo = new Date("2026-08-18T08:00:00Z");
    const twoDaysAgo = new Date("2026-08-16T12:00:00Z");

    const ledger = [
      { ruleId: "rule-1", targetId: "idea-100", firedAt: fourHoursAgo },
      { ruleId: "rule-1", targetId: "idea-200", firedAt: twoDaysAgo },
    ];

    // idea-100 fired 4h ago (within 24h window) -> duplicate
    expect(
      isDuplicateAutomationExecution(ledger, "rule-1", "idea-100", now, 24),
    ).toBe(true);

    // idea-200 fired 48h ago (outside 24h window) -> not duplicate
    expect(
      isDuplicateAutomationExecution(ledger, "rule-1", "idea-200", now, 24),
    ).toBe(false);

    // un-fired idea-300 -> not duplicate
    expect(
      isDuplicateAutomationExecution(ledger, "rule-1", "idea-300", now, 24),
    ).toBe(false);
  });

  it("filters candidate targets using ledger", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const twoHoursAgo = new Date("2026-08-18T10:00:00Z");
    const ledger = [
      { ruleId: "rule-1", targetId: "t-1", firedAt: twoHoursAgo },
    ];

    const candidates = ["t-1", "t-2", "t-3"];
    const filtered = filterDeduplicatedTargets(candidates, "rule-1", ledger, now, 24);

    expect(filtered).toEqual(["t-2", "t-3"]);
  });
});
