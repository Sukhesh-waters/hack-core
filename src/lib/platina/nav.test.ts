import { describe, expect, it } from "vitest";
import { PLATINA_NAV } from "./nav";

describe("platina nav", () => {
  it("registers exactly the six outcome-oriented destinations", () => {
    expect(PLATINA_NAV.map((s) => s.label)).toEqual([
      "Cockpit",
      "Audits",
      "Findings",
      "Solutions",
      "Outcomes",
      "Admin",
    ]);
  });

  it("has unique slugs", () => {
    const slugs = PLATINA_NAV.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keeps legacy routes out of primary navigation", () => {
    const legacy = [
      "brand",
      "scans",
      "brain",
      "ideation",
      "campaigns",
      "claims",
      "receipts",
      "config",
    ];
    for (const slug of legacy) {
      expect(PLATINA_NAV.some((s) => s.slug === slug)).toBe(false);
    }
  });
});
