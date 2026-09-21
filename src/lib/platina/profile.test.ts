import { describe, expect, it } from "vitest";
import {
  buildProfilePrompt,
  parseProfile,
  PROFILE_MAX_PAGES,
  PROFILE_PER_PAGE_CHARS,
  PROFILE_TOTAL_CHARS,
  ProfileError,
  renderProfile,
  selectProfilePages,
  type ProfilePage,
} from "./profile";

const page = (url: string, body: string, fetchedAt = "2026-09-20T10:00:00Z"): ProfilePage => ({
  url,
  kind: "competitor_site",
  title: null,
  body,
  fetchedAt,
});

describe("selectProfilePages", () => {
  it("keeps only the newest copy of a URL", () => {
    const out = selectProfilePages([
      page("https://a.com/", "old copy", "2026-09-01T00:00:00Z"),
      page("https://a.com/", "new copy", "2026-09-20T00:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("new copy");
  });

  it("puts the shallowest page first — a homepage says more than a deep article", () => {
    const out = selectProfilePages([
      page("https://a.com/blog/2026/post", "deep"),
      page("https://a.com/", "home"),
      page("https://a.com/about", "about"),
    ]);
    expect(out.map((p) => p.body)).toEqual(["home", "about", "deep"]);
  });

  it("skips empty pages and accepts Date or string timestamps", () => {
    const out = selectProfilePages([
      page("https://a.com/", "   "),
      { ...page("https://a.com/x", "real"), fetchedAt: new Date("2026-09-20T00:00:00Z") },
    ]);
    expect(out.map((p) => p.url)).toEqual(["https://a.com/x"]);
  });

  it("bounds pages, per-page size and total size so one call stays small", () => {
    const many = Array.from({ length: 20 }, (_, i) => page(`https://a.com/p${i}`, "word ".repeat(2000)));
    const out = selectProfilePages(many);
    expect(out.length).toBeLessThanOrEqual(PROFILE_MAX_PAGES);
    expect(out.every((p) => p.body.length <= PROFILE_PER_PAGE_CHARS)).toBe(true);
    expect(out.reduce((n, p) => n + p.body.length, 0)).toBeLessThanOrEqual(PROFILE_TOTAL_CHARS + PROFILE_PER_PAGE_CHARS);
  });

  it("still returns one page when the first alone exceeds the total budget", () => {
    expect(selectProfilePages([page("https://a.com/", "x".repeat(50_000))])).toHaveLength(1);
  });
});

describe("buildProfilePrompt", () => {
  it("shows the model the pages and forbids outside knowledge", () => {
    const prompt = buildProfilePrompt("Acme", [page("https://acme.com/", "We make anvils.")]);
    expect(prompt).toContain("Client: Acme");
    expect(prompt).toContain("https://acme.com/");
    expect(prompt).toContain("We make anvils.");
    expect(prompt).toContain("Do not use outside knowledge and do not invent");
  });
});

describe("parseProfile", () => {
  const ok = {
    summary: "Acme makes anvils for cartoon coyotes.",
    offers: ["Anvils"],
    audience: "Coyotes",
    tone: "playful",
    keywords: ["anvil"],
    claims: ["Fastest delivery"],
  };

  it("accepts a well-formed reply", () => {
    expect(parseProfile(JSON.stringify(ok))).toEqual(ok);
  });

  it("trims an overlong reply instead of rejecting it (a verbose model must not void the analysis)", () => {
    const parsed = parseProfile(
      JSON.stringify({
        ...ok,
        offers: Array.from({ length: 20 }, (_, i) => `offer ${i}`),
        keywords: Array.from({ length: 30 }, (_, i) => `kw${i}`),
        claims: Array.from({ length: 12 }, (_, i) => `claim ${i}`),
        summary: "S".repeat(900),
        tone: "T".repeat(500),
      }),
    );
    expect(parsed.offers).toHaveLength(6);
    expect(parsed.keywords).toHaveLength(10);
    expect(parsed.claims).toHaveLength(5);
    expect(parsed.summary.length).toBe(400);
    expect(parsed.tone.length).toBe(160);
  });

  it("defaults missing fields to empty and drops blank list entries", () => {
    const parsed = parseProfile(JSON.stringify({ summary: "A real company that sells things.", offers: ["", "  ", "Thing"] }));
    expect(parsed).toMatchObject({ offers: ["Thing"], audience: "", tone: "", keywords: [], claims: [] });
  });

  it("fails loudly on non-JSON and on a profile with nothing in it", () => {
    expect(() => parseProfile("not json")).toThrow(ProfileError);
    expect(() => parseProfile(JSON.stringify({ summary: "" }))).toThrow(/did not say enough/);
    expect(() => parseProfile(JSON.stringify({ summary: "short" }))).toThrow(ProfileError);
  });
});

describe("renderProfile", () => {
  it("omits empty fields rather than faking them", () => {
    const text = renderProfile({ summary: "Sells anvils to coyotes.", offers: [], audience: "", tone: "playful", keywords: ["x"], claims: [] });
    expect(text).toBe("What they do: Sells anvils to coyotes.\nTone: playful");
    expect(text).not.toContain("Offers");
    expect(text).not.toContain("x");
  });
});
