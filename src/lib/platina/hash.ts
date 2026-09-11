import { createHash } from "node:crypto";

/** Canonical payload hash for gate events. Nothing in InstaMedia computes this. */
export function hashGatePayload(payload: unknown): string {
  const canonical = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
