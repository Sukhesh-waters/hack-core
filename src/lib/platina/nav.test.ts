import { describe, expect, it } from "vitest";
import { PLATINA_NAV } from "./nav";

describe("platina nav", () => {
  it("registers campaign planning as the only destination", () => {
    expect(PLATINA_NAV.map((s) => s.label)).toEqual(["Plan"]);
    expect(PLATINA_NAV.map((s) => s.slug)).toEqual(["plan"]);
  });

  it("has unique slugs", () => {
    const slugs = PLATINA_NAV.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keeps every other surface out of primary navigation (hidden, not deleted)", () => {
    const hidden = [
      "",
      "audits",
      "findings",
      "solutions",
      "outcomes",
      "admin",
      "brand",
      "scans",
      "brain",
      "ideation",
      "campaigns",
      "claims",
      "receipts",
      "config",
    ];
    for (const slug of hidden) {
      expect(PLATINA_NAV.some((s) => s.slug === slug)).toBe(false);
    }
  });
});
