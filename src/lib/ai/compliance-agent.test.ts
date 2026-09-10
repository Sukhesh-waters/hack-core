import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  checkCompliance,
  ComplianceError,
  enforceCompliance,
  findBannedWords,
} from "./compliance-agent";
import { refineDraft, type Draft } from "@/lib/ai/generation-agent";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
vi.mock("@/lib/ai/generation-agent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refineDraft: vi.fn(),
}));
const routeAIMock = routeAI as unknown as Mock;
const refineDraftMock = refineDraft as unknown as Mock;

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
  hashtags: ["#specialtycoffee"],
  cta: "Save this for your next visit.",
};

const FIXED_DRAFT: Draft = { ...DRAFT, caption: "A cleaner caption." };

const PASS = JSON.stringify({ verdict: "pass", violations: [] });
const FAIL = JSON.stringify({
  verdict: "fail",
  violations: [
    {
      rule: "No discount talk",
      excerpt: "50% off",
      why: "Mentions a discount",
    },
  ],
});

beforeEach(() => {
  routeAIMock.mockReset();
  refineDraftMock.mockReset();
});

describe("checkCompliance", () => {
  it("returns a pass verdict with no violations", async () => {
    routeAIMock.mockResolvedValue(PASS);
    const result = await checkCompliance({ draft: DRAFT, identity: IDENTITY });
    expect(result).toEqual({ verdict: "pass", violations: [] });
    const call = routeAIMock.mock.calls[0][0];
    expect(call.tier).toBe("quality");
    expect(call.json).toBe(true);
    expect(call.prompt).toContain("No discount talk");
  });

  it("returns violations on fail", async () => {
    routeAIMock.mockResolvedValue(FAIL);
    const result = await checkCompliance({ draft: DRAFT, identity: IDENTITY });
    expect(result.verdict).toBe("fail");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].rule).toBe("No discount talk");
  });

  it("throws ComplianceError on unusable model output", async () => {
    routeAIMock.mockResolvedValue("not json");
    await expect(
      checkCompliance({ draft: DRAFT, identity: IDENTITY }),
    ).rejects.toBeInstanceOf(ComplianceError);
  });
});

describe("enforceCompliance (1 retry max, no agent spawns an agent)", () => {
  it("pass on first check: no refinement call at all", async () => {
    routeAIMock.mockResolvedValue(PASS);
    const result = await enforceCompliance({
      draft: DRAFT,
      identity: IDENTITY,
    });
    expect(result).toEqual({
      draft: DRAFT,
      verdict: "passed",
      violations: [],
      retried: false,
    });
    expect(refineDraftMock).not.toHaveBeenCalled();
  });

  it("fail then pass: exactly one refine, returns fixed draft", async () => {
    routeAIMock.mockResolvedValueOnce(FAIL).mockResolvedValueOnce(PASS);
    refineDraftMock.mockResolvedValue(FIXED_DRAFT);
    const result = await enforceCompliance({
      draft: DRAFT,
      identity: IDENTITY,
    });
    expect(result.verdict).toBe("passed");
    expect(result.draft).toEqual(FIXED_DRAFT);
    expect(result.retried).toBe(true);
    expect(refineDraftMock).toHaveBeenCalledTimes(1);
    // The retry feeds the violations back as feedback
    expect(refineDraftMock.mock.calls[0][0].feedback).toContain(
      "No discount talk",
    );
  });

  it("fail twice: stays flagged, never a second retry", async () => {
    routeAIMock.mockResolvedValue(FAIL);
    refineDraftMock.mockResolvedValue(FIXED_DRAFT);
    const result = await enforceCompliance({
      draft: DRAFT,
      identity: IDENTITY,
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations).toHaveLength(1);
    expect(result.retried).toBe(true);
    expect(refineDraftMock).toHaveBeenCalledTimes(1);
    expect(routeAIMock).toHaveBeenCalledTimes(2);
  });
});

describe("findBannedWords (deterministic, word-boundary)", () => {
  const clean: Draft = {
    caption: "A gentle routine",
    script: "Show the routine",
    hashtags: ["#skincare"],
    cta: "Save this",
  };

  it("flags a banned word in every draft field", () => {
    expect(
      findBannedWords({ ...clean, caption: "The cure is here" }, ["cure"]),
    ).toHaveLength(1);
    expect(
      findBannedWords({ ...clean, script: "Say cure on camera" }, ["cure"]),
    ).toHaveLength(1);
    expect(
      findBannedWords({ ...clean, hashtags: ["#cure"] }, ["cure"]),
    ).toHaveLength(1);
    const ctaHits = findBannedWords({ ...clean, cta: "Cure it today" }, [
      "cure",
    ]);
    expect(ctaHits).toHaveLength(1);
    expect(ctaHits[0].why).toContain("cta");
  });

  it("matches case-insensitively and across hyphenated compounds", () => {
    const hits = findBannedWords({ ...clean, caption: "50% off CURE-all" }, [
      "cure",
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule).toContain("cure");
  });

  it("respects word boundaries: 'cure' never flags 'secure'", () => {
    expect(
      findBannedWords({ ...clean, caption: "A secure checkout" }, ["cure"]),
    ).toEqual([]);
  });

  it("matches multi-word phrases across whitespace", () => {
    expect(
      findBannedWords(
        { ...clean, script: "backed by clinical  claims data" },
        ["clinical claims"],
      ),
    ).toHaveLength(1);
    expect(
      findBannedWords({ ...clean, script: "clinical trials" }, [
        "clinical claims",
      ]),
    ).toEqual([]);
  });

  it("ignores empty/whitespace terms", () => {
    expect(findBannedWords(clean, ["", "  "])).toEqual([]);
  });
});

describe("enforceCompliance deterministic banned words", () => {
  const BANNED_IDENTITY = { ...IDENTITY, bannedWords: ["cure"] };
  const BANNED_DRAFT: Draft = { ...DRAFT, caption: "This cure works." };

  it("fails on a banned word even when the LLM says pass — first check", async () => {
    routeAIMock.mockResolvedValue(PASS);
    refineDraftMock.mockResolvedValue(BANNED_DRAFT); // refine fails to remove it
    const result = await enforceCompliance({
      draft: BANNED_DRAFT,
      identity: BANNED_IDENTITY,
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations[0].rule).toContain("cure");
    // retry still capped at exactly 1
    expect(refineDraftMock).toHaveBeenCalledTimes(1);
    expect(refineDraftMock.mock.calls[0][0].feedback).toContain("cure");
  });

  it("passes when the retry actually removes the banned word", async () => {
    routeAIMock.mockResolvedValue(PASS);
    refineDraftMock.mockResolvedValue(FIXED_DRAFT);
    const result = await enforceCompliance({
      draft: BANNED_DRAFT,
      identity: BANNED_IDENTITY,
    });
    expect(result.verdict).toBe("passed");
    expect(result.draft).toEqual(FIXED_DRAFT);
    expect(result.retried).toBe(true);
  });

  it("vault regression: a word added via updateBrandContext fails a draft that previously passed", async () => {
    const { mergeBrandDna } = await import("@/lib/ai/brand-merge");
    const declared = {
      brandType: "product_promotion" as const,
      mission: "Coffee, honestly.",
      showcaseTheme: "Warm craft",
      tones: ["Warm"],
      pillars: [],
      bannedWords: [] as string[],
      avoidTopics: [],
      colors: [],
      typography: null,
      logoUrl: null,
      links: {},
    };
    routeAIMock.mockResolvedValue(PASS);

    // Before the vault edit: draft passes
    const before = await enforceCompliance({
      draft: DRAFT,
      identity: mergeBrandDna(declared, IDENTITY),
    });
    expect(before.verdict).toBe("passed");

    // Vault edit adds "crema" — same draft must now fail deterministically
    refineDraftMock.mockResolvedValue(DRAFT); // refine doesn't remove it
    const after = await enforceCompliance({
      draft: DRAFT,
      identity: mergeBrandDna(
        { ...declared, bannedWords: ["crema"] },
        IDENTITY,
      ),
    });
    expect(after.verdict).toBe("flagged");
    expect(after.violations[0].rule).toContain("crema");
  });

  it("clean draft with banned list configured: no deterministic noise", async () => {
    routeAIMock.mockResolvedValue(PASS);
    const result = await enforceCompliance({
      draft: DRAFT,
      identity: BANNED_IDENTITY,
    });
    expect(result.verdict).toBe("passed");
    expect(refineDraftMock).not.toHaveBeenCalled();
  });
});
