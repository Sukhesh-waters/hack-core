import { describe, expect, it } from "vitest";
import { hashGatePayload } from "./hash";

describe("hashGatePayload", () => {
  it("is deterministic for the same payload", () => {
    const a = hashGatePayload({ id: "1", gate: "declare" });
    const b = hashGatePayload({ id: "1", gate: "declare" });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when the payload changes", () => {
    expect(hashGatePayload({ id: "1" })).not.toBe(hashGatePayload({ id: "2" }));
  });
});
