import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buildInsightPrompt,
  generatePatternInsights,
  PatternInsightError,
  validateEvidence,
  type PatternPostInput,
} from "./pattern-insight-agent";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

const POSTS: PatternPostInput[] = [
  {
    id: "pat_1",
    pageHandle: "glowlab",
    segment: "hashtag:skincare",
    caption: "3 steps to calmer skin — save this",
    format: "reel",
    likes: 5400,
    comments: 210,
  },
  {
    id: "pat_2",
    pageHandle: "dermdaily",
    segment: "competitor_handle:dermdaily",
    caption: "Myth: more actives = better results",
    format: "carousel",
    likes: 3100,
    comments: 145,
  },
];

beforeEach(() => routeAIMock.mockReset());

describe("validateEvidence (two-layer guardrail)", () => {
  it("strips evidence ids that are not pattern rows — baseline ids can never leak in", () => {
    const out = validateEvidence(
      [
        {
          pattern: "Listicle hooks",
          evidence: ["pat_1", "post_baseline_7", "forged"],
          suggestion: "Try a 3-step list format",
        },
      ],
      ["pat_1", "pat_2"],
    );
    expect(out[0].evidence).toEqual(["pat_1"]);
  });

  it("layer separation: insight evidence never intersects baseline citation ids", () => {
    const baselineCitationIds = ["post_a", "post_b"];
    const out = validateEvidence(
      [
        {
          pattern: "x",
          evidence: ["post_a", "pat_2"],
          suggestion: "y",
        },
      ],
      POSTS.map((p) => p.id),
    );
    const intersection = out[0].evidence.filter((id) =>
      baselineCitationIds.includes(id),
    );
    expect(intersection).toEqual([]);
  });
});

describe("buildInsightPrompt", () => {
  it("frames posts as inspiration only, never brand performance", () => {
    const prompt = buildInsightPrompt(POSTS);
    expect(prompt).toContain("inspiration only");
    expect(prompt).toContain("[pat_1]");
    expect(prompt).toContain("@glowlab");
    expect(prompt.toLowerCase()).not.toContain("baseline");
  });
});

describe("generatePatternInsights", () => {
  it("returns [] without a model call when there are no posts", async () => {
    expect(await generatePatternInsights([])).toEqual([]);
    expect(routeAIMock).not.toHaveBeenCalled();
  });

  it("parses observations and validates evidence", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        observations: [
          {
            pattern: "Save-this CTAs on reels",
            evidence: ["pat_1", "not_a_pattern_row"],
            suggestion: "Adapt a save-worthy checklist reel",
          },
        ],
      }),
    );
    const out = await generatePatternInsights(POSTS);
    expect(out).toHaveLength(1);
    expect(out[0].evidence).toEqual(["pat_1"]);
    expect(routeAIMock.mock.calls[0][0].json).toBe(true);
  });

  it("throws PatternInsightError on unusable output", async () => {
    routeAIMock.mockResolvedValue("not json");
    await expect(generatePatternInsights(POSTS)).rejects.toBeInstanceOf(
      PatternInsightError,
    );
  });
});
