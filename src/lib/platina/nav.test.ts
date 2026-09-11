import { describe, expect, it } from "vitest";
import { PLATINA_NAV, PLATINA_NAV_GROUPS } from "./nav";

describe("platina nav", () => {
  it("covers every group", () => {
    for (const group of PLATINA_NAV_GROUPS) {
      expect(PLATINA_NAV.some((s) => s.group === group)).toBe(true);
    }
  });

  it("has unique slugs", () => {
    const slugs = PLATINA_NAV.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
