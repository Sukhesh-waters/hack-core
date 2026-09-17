import { describe, expect, it } from "vitest";
import {
  CAPABILITY_LABELS,
  isCapability,
  permissionMessageFor,
  roleCan,
} from "./permissions";

describe("platina capability set (Slice 10)", () => {
  const PLATINA_CAPS = [
    "platina.audit.run",
    "platina.audit.manage",
    "platina.finding.review",
    "platina.solution.edit",
    "platina.solution.approve",
    "platina.execution.approve",
    "platina.outcome.import",
    "platina.config.manage",
  ] as const;

  it("registers all eight capabilities with labels and refusal messages", () => {
    for (const cap of PLATINA_CAPS) {
      expect(isCapability(cap)).toBe(true);
      expect(CAPABILITY_LABELS[cap]).toBeTruthy();
      expect(permissionMessageFor(cap)).toBeTruthy();
    }
  });

  it("member holds exactly the member-level Platina capabilities", () => {
    for (const cap of [
      "platina.audit.run",
      "platina.finding.review",
      "platina.solution.edit",
      "platina.task.edit",
    ] as const) {
      expect(roleCan("member", cap)).toBe(true);
    }
    for (const cap of [
      "platina.audit.manage",
      "platina.solution.approve",
      "platina.execution.approve",
      "platina.outcome.import",
      "platina.config.manage",
    ] as const) {
      expect(roleCan("member", cap)).toBe(false);
    }
  });

  it("owner and admin hold every Platina capability", () => {
    for (const cap of PLATINA_CAPS) {
      expect(roleCan("owner", cap)).toBe(true);
      expect(roleCan("admin", cap)).toBe(true);
    }
  });
});
