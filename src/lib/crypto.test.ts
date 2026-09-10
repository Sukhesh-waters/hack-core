import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

beforeEach(() =>
  vi.stubEnv("AUTH_SECRET", "test-secret-at-least-32-chars-long!!"),
);
afterEach(() => vi.unstubAllEnvs());

describe("secret encryption", () => {
  it("round-trips a token", () => {
    expect(decryptSecret(encryptSecret("IGQVJtoken123"))).toBe("IGQVJtoken123");
  });

  it("produces distinct ciphertexts per call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered payloads", () => {
    const payload = encryptSecret("token");
    const parts = payload.split(".");
    parts[2] = parts[2].slice(0, -2) + "AA";
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("refuses to run without AUTH_SECRET", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => encryptSecret("x")).toThrow("AUTH_SECRET");
  });
});
