import { describe, expect, it } from "vitest";
import { BRIEF_MAX_CHARS, briefSchema } from "./brief";

describe("briefSchema", () => {
  it("accepts a two-line brief and trims it", () => {
    const result = briefSchema.safeParse(
      "  Launch our espresso subscription.\r\nTarget: home baristas, UK.  ",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(
        "Launch our espresso subscription.\nTarget: home baristas, UK.",
      );
    }
  });

  it("rejects a brief that is too short to plan from", () => {
    expect(briefSchema.safeParse("Sell more").success).toBe(false);
  });

  it("rejects more than two lines", () => {
    const result = briefSchema.safeParse("Line one is here\nLine two is here\nLine three");
    expect(result.success).toBe(false);
  });

  it("ignores blank lines when counting", () => {
    expect(
      briefSchema.safeParse("Line one is here\n\n\nLine two is here").success,
    ).toBe(true);
  });

  it("rejects an over-long brief", () => {
    expect(briefSchema.safeParse("x".repeat(BRIEF_MAX_CHARS + 1)).success).toBe(false);
  });
});
