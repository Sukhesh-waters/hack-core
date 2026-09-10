import { describe, expect, it } from "vitest";
import { contactEmailSchema, sendReportSchema } from "./report-schemas";

describe("sendReportSchema", () => {
  const base = {
    workspaceId: "ws_1",
    clientId: "client_1",
    audience: "team" as const,
    body: "Performance report body",
  };

  it("accepts a valid team send", () => {
    const parsed = sendReportSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid client send", () => {
    const parsed = sendReportSchema.safeParse({ ...base, audience: "client" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing clientId", () => {
    const withoutClientId: Record<string, unknown> = { ...base };
    delete withoutClientId.clientId;
    const parsed = sendReportSchema.safeParse(withoutClientId);
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty clientId", () => {
    const parsed = sendReportSchema.safeParse({ ...base, clientId: "" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown audience", () => {
    const parsed = sendReportSchema.safeParse({
      ...base,
      audience: "everyone",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty report body", () => {
    const parsed = sendReportSchema.safeParse({ ...base, body: "   " });
    expect(parsed.success).toBe(false);
  });
});

describe("contactEmailSchema", () => {
  it("accepts a valid email", () => {
    const parsed = contactEmailSchema.safeParse("client@example.com");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe("client@example.com");
  });

  it("trims surrounding whitespace", () => {
    const parsed = contactEmailSchema.safeParse("  client@example.com  ");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe("client@example.com");
  });

  it("rejects an invalid email", () => {
    const parsed = contactEmailSchema.safeParse("not-an-email");
    expect(parsed.success).toBe(false);
  });

  it("maps an empty string to null", () => {
    const parsed = contactEmailSchema.safeParse("");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBeNull();
  });
});
