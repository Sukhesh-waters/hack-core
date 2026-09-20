import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  BrandResearchError,
  buildBrandPrompt,
  researchBrand,
} from "./content";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

const INPUT = {
  name: "Acme Coffee",
  handle: "@acmecoffee",
  kbStats: { total: 40, baselineSize: 38, medianEngagement: 0.08 },
  topCaptions: ["Latte art tutorial", "Spring menu launch day"],
};

const IDENTITY = {
  voice: "Warm, craft-obsessed",
  tone: "Playful but expert",
  audience: "Urban coffee enthusiasts 25-40",
  pillars: ["Craft", "Community", "Sustainability"],
  doNots: ["No discount-led messaging"],
  formats: ["reel", "carousel"],
};

beforeEach(() => routeAIMock.mockReset());

describe("buildBrandPrompt", () => {
  it("grounds the research in client facts and top drivers", () => {
    const prompt = buildBrandPrompt(INPUT);
    expect(prompt).toContain("Acme Coffee");
    expect(prompt).toContain("Latte art tutorial");
    expect(prompt).toContain("38");
    expect(prompt).not.toContain("Human-declared brand context");
  });

  it("injects declared context as authoritative and shifts task to enrich", () => {
    const prompt = buildBrandPrompt({
      ...INPUT,
      declared: {
        brandType: "educational_authority",
        mission: "Make specialty coffee approachable.",
        showcaseTheme: "Warm, craft, close-up",
        tones: ["Warm", "Educational"],
        pillars: ["Education", "Craft"],
        bannedWords: ["cheap"],
        avoidTopics: ["price wars"],
        colors: ["#0d9488"],
        typography: null,
        logoUrl: null,
        links: {},
      },
    });
    expect(prompt).toContain(
      "Human-declared brand context (authoritative — do not contradict it, enrich it)",
    );
    expect(prompt).toContain("educational authority");
    expect(prompt).toContain("cheap");
    expect(prompt).toContain("Enrich the declared context");
  });
});

describe("researchBrand", () => {
  it("runs on the quality tier and parses the identity", async () => {
    routeAIMock.mockResolvedValue(JSON.stringify(IDENTITY));
    const identity = await researchBrand(INPUT);
    expect(identity.pillars).toContain("Craft");
    expect(routeAIMock.mock.calls[0][0].tier).toBe("quality");
    expect(routeAIMock.mock.calls[0][0].json).toBe(true);
  });

  it("throws BrandResearchError on unparseable output", async () => {
    routeAIMock.mockResolvedValue("not json");
    await expect(researchBrand(INPUT)).rejects.toBeInstanceOf(
      BrandResearchError,
    );
  });

  it("throws BrandResearchError when the shape is wrong", async () => {
    routeAIMock.mockResolvedValue(JSON.stringify({ voice: "x" }));
    await expect(researchBrand(INPUT)).rejects.toBeInstanceOf(
      BrandResearchError,
    );
  });
});
