import { describe, expect, it } from "vitest";
import { NAV_GROUPS, NAV_SECTIONS } from "./nav";

describe("nav registry", () => {
  it("has streamlined sections with unique slugs across 4 groups", () => {
    expect(NAV_GROUPS).toHaveLength(4);
    const slugs = NAV_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(NAV_SECTIONS.length);
  });

  it("only uses known groups, and every group is non-empty", () => {
    for (const s of NAV_SECTIONS) {
      expect(NAV_GROUPS).toContain(s.group);
    }
    for (const g of NAV_GROUPS) {
      expect(NAV_SECTIONS.some((s) => s.group === g)).toBe(true);
    }
  });

  it("includes all core marketing, collaboration, and SOP pillars", () => {
    const live = NAV_SECTIONS.filter((s) => s.status === "live").map(
      (s) => s.slug,
    );
    for (const slug of [
      "overview",
      "sprint",
      "my-work",
      "hub",
      "sop",
      "plan",
      "production",
      "tickets",
      "docs",
      "approvals",
      "calendar",
      "brand-gene",
      "ideation",
      "studio",
      "kb",
      "decisions",
      "drift",
      "ads",
      "reports",
      "cockpit",
      "accounts",
      "clients",
      "rules",
      "workflows",
      "automations",
      "fields",
    ]) {
      expect(live).toContain(slug);
    }
  });

  it("enforces valid parentSlug references within the same nav group", () => {
    const slugMap = new Map(NAV_SECTIONS.map((s) => [s.slug, s]));

    for (const section of NAV_SECTIONS) {
      if (section.parentSlug) {
        const parent = slugMap.get(section.parentSlug);
        expect(parent).toBeDefined();
        // Parent must be a primary section (no transitive chains)
        expect(parent?.parentSlug).toBeUndefined();
        // Parent and child must belong to the same pillar
        expect(parent?.group).toBe(section.group);
      }
    }
  });
});

describe("assets section", () => {
  it("is registered live under Brand & Creative, nested below brand-gene", () => {
    const assets = NAV_SECTIONS.find((s) => s.slug === "assets");
    expect(assets).toBeDefined();
    expect(assets?.group).toBe("Brand & Creative");
    expect(assets?.parentSlug).toBe("brand-gene");
    expect(assets?.status).toBe("live");
  });
});

