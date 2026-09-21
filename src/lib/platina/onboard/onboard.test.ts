import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { routeAI } from "@/lib/ai/router";
import type { ProbeFetch } from "../fetch/probe";
import {
  buildCompetitorPrompt,
  CompetitorProposalError,
  MAX_COMPETITOR_PROPOSALS,
  parseCompetitorReply,
  proposeCompetitors,
} from "./competitors";
import {
  AD_RESULTS_PER_RUN,
  adLibrarySearch,
  candidatesToSpecs,
  deriveSources,
  MAX_SOURCES_PER_APPROVAL,
  normalizeHandle,
  normalizeHomepage,
} from "./derive";
import { discoverCandidates, preselected, sitemapFound } from "./discover";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;
beforeEach(() => {
  routeAIMock.mockReset();
});

describe("normalizeHomepage / normalizeHandle", () => {
  it.each([
    ["acme.com", "https://acme.com"],
    ["http://acme.com/some/path?x=1", "http://acme.com"],
    ["  https://www.acme.com/  ", "https://www.acme.com"],
  ])("origin of %s", (input, expected) => expect(normalizeHomepage(input)).toBe(expected));

  it.each(["", "   ", "localhost", "not a url"])("refuses %j", (input) =>
    expect(normalizeHomepage(input)).toBeNull(),
  );

  it("normalises handles and refuses impossible ones", () => {
    expect(normalizeHandle("@Acme")).toBe("Acme");
    expect(normalizeHandle(" acme.co ")).toBe("acme.co");
    expect(normalizeHandle("has space")).toBeNull();
    expect(normalizeHandle(undefined)).toBeNull();
    expect(normalizeHandle("")).toBeNull();
  });
});

describe("deriveSources", () => {
  const input = { homepageUrl: "acme.com", handles: { instagram: "@acme", tiktok: "acmetok" } };

  it("is deterministic: same input, same ids, same order", () => {
    const a = deriveSources(input).map((c) => c.id);
    const b = deriveSources({ ...input }).map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("puts the homepage first and marks it certain", () => {
    const [first] = deriveSources(input);
    expect(first).toMatchObject({ kind: "competitor_site", value: "https://acme.com", confidence: "certain" });
  });

  it("maps each handle to a profile and a posts source with the right value", () => {
    const social = deriveSources(input).filter((c) => c.kind.startsWith("social_"));
    expect(social.map((c) => `${c.kind}:${c.value}`)).toEqual([
      "social_profile:instagram:@acme",
      "social_posts:instagram:@acme",
      "social_profile:tiktok:@acmetok",
      "social_posts:tiktok:@acmetok",
    ]);
  });

  it("marks sitemap/robots as discovery aids, never content sources", () => {
    const discovery = deriveSources(input).filter((c) => c.discovery);
    expect(discovery.map((c) => c.value)).toEqual([
      "https://acme.com/sitemap.xml",
      "https://acme.com/sitemap_index.xml",
      "https://acme.com/robots.txt",
    ]);
  });

  it("yields social only when there is no website, and nothing for an empty brand", () => {
    expect(deriveSources({ homepageUrl: "", handles: { instagram: "acme" } }).every((c) => c.kind.startsWith("social_"))).toBe(true);
    expect(deriveSources({ homepageUrl: "", handles: {} })).toEqual([]);
  });
});

describe("candidatesToSpecs", () => {
  const all = deriveSources({ homepageUrl: "acme.com", handles: { instagram: "acme" } });

  it("makes one single-target spec per approved source, skipping discovery aids", () => {
    const specs = candidatesToSpecs("Acme", all, false);
    expect(specs.every((s) => s.targets.length === 1)).toBe(true);
    expect(specs.some((s) => s.targets[0].value.endsWith("robots.txt"))).toBe(false);
  });

  it("seeds only the homepage from the sitemap, and only when one was found", () => {
    const withMap = candidatesToSpecs("Acme", all, true);
    expect(withMap.find((s) => s.targets[0].value === "https://acme.com")?.targets[0].seedFromSitemap).toBe(true);
    expect(withMap.find((s) => s.targets[0].value.endsWith("/blog"))?.targets[0].seedFromSitemap).toBeUndefined();
    expect(candidatesToSpecs("Acme", all, false).some((s) => s.targets[0].seedFromSitemap)).toBe(false);
  });

  it("names sources so a person can read them (not 'Acme · ads/library/')", () => {
    const names = candidatesToSpecs(
      "Acme",
      deriveSources({ homepageUrl: "acme.com", handles: {}, brandName: "Acme" }),
      false,
    ).map((s) => s.name);
    expect(names).toContain("Acme · website");
    expect(names).toContain("Acme · blog");
    expect(names).toContain("Acme · ads");
    expect(names.some((n) => n.includes("/"))).toBe(false);
  });

  it("carries the per-source page budget", () => {
    const posts = candidatesToSpecs("Acme", all, false).find((s) => s.targets[0].kind === "social_posts");
    expect(posts?.targets[0].maxPages).toBe(10);
  });

  it("dedupes and caps a single approval", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...all[0], id: `x${i}`, value: `https://acme.com/p${i}` }));
    expect(candidatesToSpecs("Acme", [...many, ...many], false)).toHaveLength(MAX_SOURCES_PER_APPROVAL);
  });
});

describe("discoverCandidates", () => {
  const candidates = deriveSources({ homepageUrl: "acme.com", handles: { instagram: "acme" } });
  const fakeFetch = (statuses: Record<string, number | "throw">): ProbeFetch => async (url) => {
    const s = statuses[url] ?? 404;
    if (s === "throw") throw new Error("network");
    return { status: s, headers: { get: () => null } };
  };

  it("upgrades a found guess, downgrades nothing, and never drops a candidate", async () => {
    const found = await discoverCandidates(
      candidates,
      fakeFetch({ "https://acme.com": 200, "https://acme.com/blog": 200, "https://acme.com/sitemap.xml": 200 }),
    );
    expect(found).toHaveLength(candidates.length);
    expect(found.find((c) => c.value.endsWith("/blog"))).toMatchObject({ exists: true, confidence: "likely" });
    expect(found.find((c) => c.value.endsWith("/news"))).toMatchObject({ exists: false, confidence: "guess" });
    expect(sitemapFound(found)).toBe(true);
  });

  it("reports 'could not tell' for a WAF or network failure instead of 'missing'", async () => {
    const found = await discoverCandidates(candidates, fakeFetch({ "https://acme.com/blog": 403, "https://acme.com/news": "throw" }));
    expect(found.find((c) => c.value.endsWith("/blog"))?.exists).toBeNull();
    expect(found.find((c) => c.value.endsWith("/news"))?.exists).toBeNull();
  });

  it("does not probe social sources", async () => {
    const seen: string[] = [];
    await discoverCandidates(candidates, async (url) => {
      seen.push(url);
      return { status: 200, headers: { get: () => null } };
    });
    expect(seen.some((u) => u.includes("instagram"))).toBe(false);
  });

  it("preselects certain sources and confirmed paths only", async () => {
    const found = await discoverCandidates(candidates, fakeFetch({ "https://acme.com/blog": 200 }));
    expect(preselected(found.find((c) => c.value === "https://acme.com")!)).toBe(true);
    expect(preselected(found.find((c) => c.value.endsWith("/blog"))!)).toBe(true);
    expect(preselected(found.find((c) => c.value.endsWith("/news"))!)).toBe(false);
    expect(preselected(found.find((c) => c.discovery)!)).toBe(false);
  });
});

describe("competitor proposals", () => {
  const reply = (competitors: unknown[]) => JSON.stringify({ competitors });
  const ok = (over: Record<string, unknown> = {}) => ({
    name: "Rival Co",
    homepageUrl: "https://rival.com/about",
    reason: "Same market",
    confidence: "high",
    ...over,
  });

  it("builds a prompt that forbids invented domains", () => {
    const p = buildCompetitorPrompt({ name: "Acme", homepageUrl: "https://acme.com", region: null });
    expect(p).toContain("Client: Acme");
    expect(p).toContain("Do not invent domains");
  });

  it("normalises to origins, dedupes, and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ok({ name: `Rival ${i}`, homepageUrl: `r${i}.com` }));
    const out = parseCompetitorReply(reply([ok(), ok({ name: "Dup" }), ...many]));
    expect(out[0].homepageUrl).toBe("https://rival.com");
    expect(out.filter((c) => c.homepageUrl === "https://rival.com")).toHaveLength(1);
    expect(out.length).toBeLessThanOrEqual(MAX_COMPETITOR_PROPOSALS);
  });

  it("drops proposals with an unusable website", () => {
    expect(parseCompetitorReply(reply([ok({ homepageUrl: "not a url" })]))).toEqual([]);
  });

  it("raises a typed error on a malformed reply, never an empty silent list", () => {
    expect(() => parseCompetitorReply("nope")).toThrow(CompetitorProposalError);
    expect(() => parseCompetitorReply(JSON.stringify({ competitors: [{ name: "x" }] }))).toThrow(
      CompetitorProposalError,
    );
  });

  it("wraps a router failure in the same typed error, on the fast tier", async () => {
    routeAIMock.mockImplementation(async () => {
      throw new Error("Groq down");
    });
    await expect(proposeCompetitors({ name: "Acme", homepageUrl: null, region: null })).rejects.toBeInstanceOf(
      CompetitorProposalError,
    );
    expect(routeAIMock.mock.calls[0][0]).toMatchObject({ tier: "fast", json: true });
  });
});

describe("R9 — competitor ad research", () => {
  it("derives an ad-library search from the brand name", () => {
    const sources = deriveSources({
      homepageUrl: "https://bluebird.example",
      handles: {},
      brandName: "Bluebird Roasters",
    });
    const ads = sources.find((s) => s.kind === "ad_library");
    expect(ads).toBeDefined();
    expect(ads!.value).toContain("Bluebird%20Roasters");
    expect(ads!.maxPages).toBe(AD_RESULTS_PER_RUN);
    // Ads move on campaign cadence, not page cadence.
    expect(ads!.cadenceMinutes).toBe(24 * 60);
  });

  it("derives nothing when no brand name is given, so existing callers are unchanged", () => {
    const sources = deriveSources({ homepageUrl: "https://bluebird.example", handles: {} });
    expect(sources.some((s) => s.kind === "ad_library")).toBe(false);
  });

  it("refuses a name too short to search for", () => {
    expect(adLibrarySearch(" a ")).toBeNull();
    expect(adLibrarySearch("")).toBeNull();
  });

  it("is never probed, so it cannot be pre-ticked into a spend", async () => {
    const fetchImpl = vi.fn();
    const discovered = await discoverCandidates(
      deriveSources({ homepageUrl: "", handles: {}, brandName: "Bluebird Roasters" }),
      fetchImpl as never,
    );
    const ads = discovered.find((c) => c.kind === "ad_library")!;
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ads.exists).toBeNull();
    expect(preselected(ads)).toBe(false);
  });
});
