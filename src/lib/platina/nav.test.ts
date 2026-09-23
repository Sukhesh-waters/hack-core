import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PLATINA_NAV, PLATINA_NAV_GROUPS } from "./nav";

describe("platina nav", () => {
  it("registers the destinations, grouped by the loop (C7.9)", () => {
    expect(PLATINA_NAV.map((s) => `${s.group}/${s.label}`)).toEqual([
      "/Cockpit",
      "Watch/Live flow",
      "Watch/Events",
      "Watch/Clients",
      "Decide/Opportunities",
      "Decide/Plan",
      "Learn/Results",
      "Learn/Outcomes",
      "Review/Audits",
      "Review/Findings",
      "Review/Solutions",
      "Admin/Admin",
    ]);
  });

  it("lists entries in group order, so each group renders once", () => {
    const order = PLATINA_NAV.map((s) => PLATINA_NAV_GROUPS.indexOf(s.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("every entry resolves to a page file", () => {
    const app = join(__dirname, "..", "..", "app", "(platina)", "p", "[ws]");
    for (const s of PLATINA_NAV) {
      expect(existsSync(join(app, s.slug, "page.tsx")), s.slug || "(cockpit)").toBe(true);
    }
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
