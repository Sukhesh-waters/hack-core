import { describe, expect, it, vi } from "vitest";
import type { BrandIdentity } from "@/db/schema";
import type { DriverPost } from "@/lib/ai/retrieval";

const routeAI = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/router", () => ({ routeAI }));

const {
  buildPlanSuggestionPrompt,
  containsEvidenceLanguage,
  isEmptySuggestion,
  markPlanDeclaredOnly,
  PlanSuggestionError,
  suggestPlanRow,
} = await import("./suggest-row");

const identity: BrandIdentity = {
  voice: "Warm",
  tone: "Direct",
  audience: "Skincare buyers",
  pillars: ["Education"],
  doNots: ["No medical claims"],
} as BrandIdentity;

const row = {
  clientName: "Aurora Skincare",
  title: "Barrier repair basics",
  type: "reel",
  durationSec: 30,
  pillar: null,
  strategyNote: null,
  scheduledForIso: null,
};

const drivers: DriverPost[] = [
  {
    id: "post_abc",
    caption: "Barrier repair explained",
    direction: "over",
    magnitude: 1.4,
    format: "reel",
  },
];

describe("buildPlanSuggestionPrompt — two-layer separation", () => {
  it("carries only the row, brand DNA and first-party brief", () => {
    const prompt = buildPlanSuggestionPrompt({
      row,
      identity,
      brief: "Driver: post_abc outperformed on barrier education.",
      drivers,
      declaredOnly: false,
    });
    expect(prompt).toContain("Aurora Skincare");
    expect(prompt).toContain("Barrier repair basics");
    expect(prompt).toContain("first-party evidence");
  });

  /**
   * The structural guarantee: PlanRowContext has nowhere to put a pattern
   * row, so pattern data cannot reach this prompt even by mistake. This
   * asserts the prompt never mentions the pattern layer.
   */
  it("never references the pattern layer", () => {
    const prompt = buildPlanSuggestionPrompt({
      row,
      identity,
      brief: "Driver: post_abc outperformed.",
      drivers,
      declaredOnly: false,
    }).toLowerCase();
    for (const leak of ["pattern", "competitor", "inspiration", "scraped"]) {
      expect(prompt, `prompt must not mention "${leak}"`).not.toContain(leak);
    }
  });

  it("forbids evidence language explicitly under declared-only", () => {
    const prompt = buildPlanSuggestionPrompt({
      row,
      identity,
      brief: "No first-party baseline yet.",
      drivers: [],
      declaredOnly: true,
    });
    expect(prompt).toContain("NO first-party performance baseline");
    expect(prompt.toLowerCase()).toContain("do not claim");
  });
});

describe("containsEvidenceLanguage", () => {
  it("catches evidence-flavoured claims", () => {
    for (const text of [
      "Your data shows this format wins",
      "This is your top-performing pillar",
      "Historically this angle outperforms",
      "We've seen strong engagement data here",
    ]) {
      expect(containsEvidenceLanguage(text), text).toBe(true);
    }
  });

  it("leaves ordinary strategy language alone", () => {
    for (const text of [
      "Lead with the barrier-repair benefit in the first two seconds",
      "Tie this to the education pillar",
    ]) {
      expect(containsEvidenceLanguage(text), text).toBe(false);
    }
  });
});

describe("markPlanDeclaredOnly — min-N honesty", () => {
  it("drops fields that claim evidence there is no baseline for", () => {
    const cleaned = markPlanDeclaredOnly({
      title: "Barrier repair basics",
      strategyNote: "Your data shows this pillar outperforms.",
      pillar: "Education",
    });
    expect(cleaned.strategyNote).toBeUndefined();
    expect(cleaned.title).toBe("Barrier repair basics");
    expect(cleaned.pillar).toBe("Education");
  });

  it("keeps honest declared-context advice", () => {
    const cleaned = markPlanDeclaredOnly({
      strategyNote: "Open on the barrier-repair promise, per the brand voice.",
    });
    expect(cleaned.strategyNote).toBeDefined();
  });
});

describe("isEmptySuggestion", () => {
  it("is true once the scrub removed everything", () => {
    expect(isEmptySuggestion(markPlanDeclaredOnly({}))).toBe(true);
    expect(
      isEmptySuggestion(
        markPlanDeclaredOnly({ strategyNote: "your data shows X" }),
      ),
    ).toBe(true);
  });

  it("is false when a real field survives", () => {
    expect(isEmptySuggestion({ pillar: "Education" })).toBe(false);
  });
});

describe("suggestPlanRow", () => {
  it("routes through the AI router, never a provider SDK", async () => {
    routeAI.mockResolvedValueOnce(
      JSON.stringify({ pillar: "Education", durationSec: 45 }),
    );
    const result = await suggestPlanRow({
      row,
      identity,
      brief: "Driver brief",
      drivers,
      declaredOnly: false,
    });
    expect(routeAI).toHaveBeenCalledOnce();
    expect(routeAI.mock.calls[0][0]).toMatchObject({ kind: "chat", json: true });
    expect(result.pillar).toBe("Education");
    expect(result.durationSec).toBe(45);
  });

  it("applies the declared-only scrub before returning", async () => {
    routeAI.mockResolvedValueOnce(
      JSON.stringify({ strategyNote: "Your data shows reels win here." }),
    );
    const result = await suggestPlanRow({
      row,
      identity,
      brief: "No baseline",
      drivers: [],
      declaredOnly: true,
    });
    expect(result.strategyNote).toBeUndefined();
  });

  it("throws a legible error on unusable model output", async () => {
    routeAI.mockResolvedValueOnce("not json at all");
    await expect(
      suggestPlanRow({
        row,
        identity,
        brief: "b",
        drivers,
        declaredOnly: false,
      }),
    ).rejects.toBeInstanceOf(PlanSuggestionError);
  });

  it("propagates a router failure so no revision is ever recorded", async () => {
    routeAI.mockRejectedValueOnce(new Error("provider throttled"));
    await expect(
      suggestPlanRow({
        row,
        identity,
        brief: "b",
        drivers,
        declaredOnly: false,
      }),
    ).rejects.toThrow("provider throttled");
  });
});

/**
 * Structural guard, not a behavioural one. S3 adds a new AI prompt path, and
 * the cheapest way for the two-layer rule to break in future is someone
 * "enriching" this prompt with competitor/pattern rows. This fails the moment
 * that import appears, rather than at review time.
 */
describe("two-layer separation — source-level guard", () => {
  it("the suggestion builder never imports the pattern layer", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("./suggest-row.ts", import.meta.url),
      "utf8",
    );
    const imports = source
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import"));
    for (const banned of [
      "patternPosts",
      "pattern_posts",
      "patternInsights",
      "pattern-scan",
      "patternProfiles",
    ]) {
      expect(
        imports.join("\n"),
        `suggest-row.ts must not import ${banned}`,
      ).not.toContain(banned);
    }
  });
});
