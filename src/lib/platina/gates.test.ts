import { describe, expect, it } from "vitest";
import {
  GATE_CAPABILITY,
  PLATINA_GATES,
  assertCompleteGateEvent,
  gateExists,
} from "./gates";

describe("platina gates", () => {
  it("has exactly four blocking gates", () => {
    expect(PLATINA_GATES).toEqual(["declare", "confirm", "approve", "publish"]);
  });

  it("maps every gate to a requireCapability string", () => {
    for (const gate of PLATINA_GATES) {
      expect(GATE_CAPABILITY[gate]).toBe(`gate.${gate}`);
    }
  });

  it("refuses an incomplete event", () => {
    expect(() =>
      assertCompleteGateEvent({
        workspaceId: "w",
        gate: "declare",
        decision: "approved",
        approverId: "",
        payloadHash: "abc",
        subjectType: "brand",
        subjectId: "1",
      }),
    ).toThrow(/approver/);
  });

  it("does not let callers invent a fifth gate", () => {
    expect(gateExists("declare")).toBe(true);
    expect(gateExists("skip")).toBe(false);
  });
});
