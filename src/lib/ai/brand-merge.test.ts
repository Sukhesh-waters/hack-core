import { describe, expect, it } from "vitest";
import type { BrandContext, BrandIdentity } from "@/db/schema";
import { brandDnaFromProfile, mergeBrandDna } from "./brand-merge";

const DECLARED: BrandContext = {
  brandType: "aesthetic_lifestyle",
  mission: "Barrier repair, without the guesswork.",
  showcaseTheme: "Minimal, warm, editorial",
  tones: ["Warm", "Authentic"],
  pillars: ["Education", "UGC"],
  bannedWords: ["cure", "clinical claims"],
  avoidTopics: ["competitor comparisons"],
  colors: ["#0d9488", "#f59e0b"],
  typography: "Serif display / clean sans body",
  logoUrl: "https://example.com/logo.png",
  links: { website: "https://aurora-skincare.com" },
};

const IDENTITY: BrandIdentity = {
  voice: "Warm, science-backed",
  tone: "Calm expert",
  audience: "Skincare-curious women 25-45",
  pillars: ["education", "Product", "Founder voice"],
  doNots: ["No medical claims"],
  formats: ["reel", "carousel"],
};

describe("mergeBrandDna", () => {
  it("null/null returns a valid neutral object, never throws", () => {
    const merged = mergeBrandDna(null, null);
    expect(merged.voice).toBe("Neutral");
    expect(merged.tone).toBe("Neutral");
    expect(merged.audience).toBe("General audience");
    expect(merged.pillars).toEqual([]);
    expect(merged.doNots).toEqual([]);
    expect(merged.formats).toEqual([]);
    expect(merged.brandType).toBeNull();
    expect(merged.showcaseTheme).toBeNull();
    expect(merged.colors).toEqual([]);
    expect(merged.typography).toBeNull();
    expect(merged.bannedWords).toEqual([]);
  });

  it("declared-only: derives voice/tone from tones, passes vault fields through", () => {
    const merged = mergeBrandDna(DECLARED, null);
    expect(merged.voice).toBe("Warm, Authentic");
    expect(merged.tone).toBe("Warm, Authentic");
    expect(merged.audience).toBe("General audience");
    expect(merged.pillars).toEqual(["Education", "UGC"]);
    expect(merged.doNots).toEqual([
      "cure",
      "clinical claims",
      "competitor comparisons",
    ]);
    expect(merged.bannedWords).toEqual(["cure", "clinical claims"]);
    expect(merged.brandType).toBe("aesthetic_lifestyle");
    expect(merged.showcaseTheme).toBe("Minimal, warm, editorial");
    expect(merged.colors).toEqual(["#0d9488", "#f59e0b"]);
    expect(merged.typography).toBe("Serif display / clean sans body");
  });

  it("identity-only: behaves like the old BrandIdentity path", () => {
    const merged = mergeBrandDna(null, IDENTITY);
    expect(merged.voice).toBe("Warm, science-backed");
    expect(merged.tone).toBe("Calm expert");
    expect(merged.audience).toBe("Skincare-curious women 25-45");
    expect(merged.pillars).toEqual(["education", "Product", "Founder voice"]);
    expect(merged.doNots).toEqual(["No medical claims"]);
    expect(merged.formats).toEqual(["reel", "carousel"]);
    expect(merged.bannedWords).toEqual([]);
    expect(merged.brandType).toBeNull();
  });

  it("conflict: declared wins; pillars union case-insensitively deduped", () => {
    const merged = mergeBrandDna(DECLARED, IDENTITY);
    // identity fills voice/tone/audience gaps (declared has no such fields to lose)
    expect(merged.voice).toBe("Warm, science-backed");
    expect(merged.audience).toBe("Skincare-curious women 25-45");
    // union keeps declared order first; "education" dupes "Education"
    expect(merged.pillars).toEqual([
      "Education",
      "UGC",
      "Product",
      "Founder voice",
    ]);
    // doNots = bannedWords ∪ avoidTopics ∪ identity.doNots
    expect(merged.doNots).toEqual([
      "cure",
      "clinical claims",
      "competitor comparisons",
      "No medical claims",
    ]);
    // declared vault fields always pass through verbatim
    expect(merged.bannedWords).toEqual(["cure", "clinical claims"]);
    expect(merged.colors).toEqual(["#0d9488", "#f59e0b"]);
  });

  it("brandDnaFromProfile: null profile or empty profile row → null; any source → merged", () => {
    expect(brandDnaFromProfile(null)).toBeNull();
    expect(brandDnaFromProfile({ declared: null, identity: null })).toBeNull();
    expect(
      brandDnaFromProfile({ declared: DECLARED, identity: null })?.bannedWords,
    ).toEqual(["cure", "clinical claims"]);
    expect(
      brandDnaFromProfile({ declared: null, identity: IDENTITY })?.voice,
    ).toBe("Warm, science-backed");
  });

  it("dedupes doNots case-insensitively across sources", () => {
    const merged = mergeBrandDna(
      { ...DECLARED, bannedWords: ["Cure"], avoidTopics: ["cure"] },
      { ...IDENTITY, doNots: ["CURE"] },
    );
    expect(merged.doNots).toEqual(["Cure"]);
  });
});
