import { describe, expect, it } from "vitest";
import { checkEnv, envSchema } from "./env";

const fullEnv = {
  DATABASE_URL: "postgresql://user:pass@host:5432/db",
  AUTH_SECRET: "a-very-secret-value",
  AUTH_GOOGLE_ID: "google-client-id",
  AUTH_GOOGLE_SECRET: "google-client-secret",
  RESEND_API_KEY: "re_123",
  EMAIL_FROM: "Platina AI OS <noreply@instamedia.ai>",
  GROQ_API_KEY: "groq_123",
  APIFY_TOKEN: "apify_123",
};

/** Returns a copy of fullEnv with the given keys removed. */
function omit(
  keys: Array<keyof typeof fullEnv>,
): Partial<typeof fullEnv> {
  const copy: Partial<typeof fullEnv> = { ...fullEnv };
  for (const key of keys) delete copy[key];
  return copy;
}

describe("envSchema", () => {
  it("round-trips a full valid env", () => {
    expect(envSchema.safeParse(fullEnv).success).toBe(true);
  });

  it("rejects a missing required key", () => {
    expect(envSchema.safeParse(omit(["DATABASE_URL"])).success).toBe(false);
  });

  it("rejects an empty-string value", () => {
    expect(
      envSchema.safeParse({ ...fullEnv, GROQ_API_KEY: "" }).success,
    ).toBe(false);
  });
});

describe("checkEnv", () => {
  it("passes in production with a full env", () => {
    const result = checkEnv(fullEnv, "production");
    expect(result.ok).toBe(true);
  });

  it("fails in production when one required var is missing, naming it", () => {
    const result = checkEnv(omit(["EMAIL_FROM"]), "production");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("EMAIL_FROM");
      expect(result.missing).toHaveLength(1);
    }
  });

  it("fails in production when multiple required vars are missing, naming all of them", () => {
    const result = checkEnv(
      omit(["EMAIL_FROM", "GROQ_API_KEY", "APIFY_TOKEN"]),
      "production",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(
        expect.arrayContaining(["EMAIL_FROM", "GROQ_API_KEY", "APIFY_TOKEN"]),
      );
      expect(result.missing).toHaveLength(3);
    }
  });

  it("treats an empty-string value as missing in production", () => {
    const result = checkEnv({ ...fullEnv, AUTH_SECRET: "" }, "production");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("AUTH_SECRET");
    }
  });

  it("in development, missing vars do not fail the check but are listed as warnings", () => {
    const result = checkEnv(
      omit(["EMAIL_FROM", "GROQ_API_KEY"]),
      "development",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual(
        expect.arrayContaining(["EMAIL_FROM", "GROQ_API_KEY"]),
      );
    }
  });

  it("in development, a full env produces no warnings", () => {
    const result = checkEnv(fullEnv, "development");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("in test env (non-production), missing vars only warn", () => {
    const result = checkEnv({}, "test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});
