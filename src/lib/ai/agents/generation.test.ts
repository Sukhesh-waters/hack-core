import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  formatDraftBody,
  generateDraft,
  GenerationError,
  normalizeHashtags,
  parseDraftBody,
  refineDraft,
  type Draft,
} from "./content";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

const IDENTITY = {
  voice: "Warm",
  tone: "Expert",
  audience: "Coffee lovers",
  pillars: ["Craft"],
  doNots: ["No discount talk"],
  formats: ["reel"],
};

const DRAFT: Draft = {
  caption: "From green bean to golden crema — the 14-day journey.",
  script: "Open on raw beans. Cut to roaster. Close on the pour.",
  hashtags: ["#specialtycoffee", "#roastery"],
  cta: "Save this for your next visit.",
};

beforeEach(() => routeAIMock.mockReset());

describe("draft body round-trip", () => {
  it("formatDraftBody → parseDraftBody preserves every field", () => {
    const body = formatDraftBody(DRAFT);
    expect(body).toContain("## Caption");
    expect(parseDraftBody(body)).toEqual(DRAFT);
  });

  it("parseDraftBody returns null for non-draft bodies", () => {
    expect(parseDraftBody("free text")).toBeNull();
  });
});

describe("normalizeHashtags", () => {
  it("prefixes bare tags and leaves #-prefixed ones alone", () => {
    expect(normalizeHashtags(["coffee", "#roast"])).toEqual([
      "#coffee",
      "#roast",
    ]);
  });

  it("splits a free-text string and drops blanks", () => {
    expect(normalizeHashtags("  coffee   #roast  ")).toEqual([
      "#coffee",
      "#roast",
    ]);
  });

  it("produces a body the draft parser accepts (manual start-draft path)", () => {
    const body = formatDraftBody({
      caption: "Hand-typed caption",
      script: "Hand-typed script",
      hashtags: normalizeHashtags("launch newdrop"),
      cta: "Shop now",
    });
    const parsed = parseDraftBody(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.hashtags).toEqual(["#launch", "#newdrop"]);
  });
});

describe("generateDraft", () => {
  it("runs quality tier, brand-tuned, and normalizes hashtags", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({ ...DRAFT, hashtags: ["specialtycoffee", "#roastery"] }),
    );
    const draft = await generateDraft({
      idea: { hook: "Behind the roast", angle: "Process", format: "reel" },
      identity: IDENTITY,
    });
    expect(draft.hashtags).toEqual(["#specialtycoffee", "#roastery"]);
    expect(routeAIMock.mock.calls[0][0].tier).toBe("quality");
    expect(routeAIMock.mock.calls[0][0].prompt).toContain("No discount talk");
  });

  it("throws GenerationError on malformed output", async () => {
    routeAIMock.mockResolvedValue("not json");
    await expect(
      generateDraft({
        idea: { hook: "h", angle: "a", format: "reel" },
        identity: IDENTITY,
      }),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});

describe("refineDraft", () => {
  it("includes the feedback and prior draft verbatim, single call", async () => {
    routeAIMock.mockResolvedValue(JSON.stringify(DRAFT));
    await refineDraft({
      draft: DRAFT,
      feedback: "Make the CTA punchier",
      identity: IDENTITY,
    });
    expect(routeAIMock).toHaveBeenCalledTimes(1);
    const prompt = routeAIMock.mock.calls[0][0].prompt;
    expect(prompt).toContain("Make the CTA punchier");
    expect(prompt).toContain(DRAFT.caption);
  });
});
