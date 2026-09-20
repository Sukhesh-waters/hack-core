import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buildIdeationPrompt,
  combineIdeas,
  DECLARED_ONLY_REASON,
  generateIdeas,
  IdeationError,
  markDeclaredOnly,
  validateCitations,
  type IdeaDraft,
} from "./strategy";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

const IDENTITY = {
  voice: "Warm",
  tone: "Expert",
  audience: "Coffee lovers",
  pillars: ["Craft"],
  doNots: ["No discounts"],
  formats: ["reel"],
};

function idea(overrides: Partial<IdeaDraft> = {}): IdeaDraft {
  return {
    hook: "Behind the roast",
    angle: "Show the process",
    format: "reel",
    why: { reason: "Process content over-performs", citations: [] },
    ...overrides,
  };
}

beforeEach(() => routeAIMock.mockReset());

describe("validateCitations (constitution guardrail)", () => {
  it("strips citations that are not first-party baseline rows — never cited, ever", () => {
    const out = validateCitations(
      [
        idea({
          why: {
            reason: "r",
            citations: ["post_real", "post_forged", "pattern_row"],
          },
        }),
      ],
      ["post_real"],
    );
    expect(out[0].why.citations).toEqual(["post_real"]);
  });

  it("keeps the reason even when every citation is stripped", () => {
    const out = validateCitations(
      [idea({ why: { reason: "still useful", citations: ["bogus"] } })],
      [],
    );
    expect(out[0].why).toEqual({ reason: "still useful", citations: [] });
  });
});

describe("markDeclaredOnly (empty-baseline honesty)", () => {
  it("rewrites why to the declared-context reason with zero citations", () => {
    const out = markDeclaredOnly([
      idea({ why: { reason: "model said so", citations: ["post_fake"] } }),
      idea(),
    ]);
    expect(out).toHaveLength(2);
    for (const item of out) {
      expect(item.why.reason).toBe(DECLARED_ONLY_REASON);
      expect(item.why.citations).toEqual([]);
    }
  });
});

describe("generateIdeas", () => {
  it("runs on the quality tier and returns validated ideas", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        ideas: [
          {
            ...idea(),
            why: {
              reason: "Launch reels over-perform",
              citations: ["allowed", "forged"],
            },
          },
          idea(),
          idea(),
          idea(),
        ],
      }),
    );
    const drivers = [
      { id: "allowed", caption: "c", direction: "up", magnitude: 1, format: null },
    ];
    const ideas = await generateIdeas({
      topic: "summer",
      identity: IDENTITY,
      brief: "the brief",
      drivers,
    });
    expect(ideas).toHaveLength(4);
    expect(ideas[0].why.citations).toEqual(["allowed"]);
    expect(routeAIMock.mock.calls[0][0].tier).toBe("quality");
    expect(routeAIMock.mock.calls[0][0].prompt).toContain("the brief");
    expect(routeAIMock.mock.calls[0][0].prompt).toContain("No discounts");
  });

  it("validates citations against the cited subset, not the full pool", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        ideas: [
          {
            ...idea(),
            why: {
              reason: "grounded",
              // "pooled" was retrieved but never cited in the brief; "cited"
              // was. Only "cited" should survive validation.
              citations: ["cited", "pooled"],
            },
          },
          idea(),
          idea(),
          idea(),
        ],
      }),
    );
    const drivers = [
      { id: "cited", caption: "c", direction: "up", magnitude: 1, format: null },
      { id: "pooled", caption: "p", direction: "up", magnitude: 1, format: null },
    ];
    const ideas = await generateIdeas({
      topic: "summer",
      identity: IDENTITY,
      brief: "the brief",
      drivers,
      citedPostIds: ["cited"],
    });
    expect(ideas[0].why.citations).toEqual(["cited"]);
  });

  it("falls back to the full driver pool when nothing was cited", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        ideas: [
          {
            ...idea(),
            why: { reason: "grounded", citations: ["pooled"] },
          },
          idea(),
          idea(),
          idea(),
        ],
      }),
    );
    const drivers = [
      { id: "pooled", caption: "p", direction: "up", magnitude: 1, format: null },
    ];
    const ideas = await generateIdeas({
      topic: "summer",
      identity: IDENTITY,
      brief: "the brief",
      drivers,
      citedPostIds: [],
    });
    expect(ideas[0].why.citations).toEqual(["pooled"]);
  });

  it("throws IdeationError on malformed output", async () => {
    routeAIMock.mockResolvedValue("nope");
    await expect(
      generateIdeas({
        topic: "t",
        identity: IDENTITY,
        brief: "b",
        drivers: [],
      }),
    ).rejects.toBeInstanceOf(IdeationError);
  });
});

describe("buildIdeationPrompt (G1 — optional client goal)", () => {
  const base = { topic: "t", identity: IDENTITY, brief: "b", drivers: [] };

  it("is byte-identical to pre-G1 output when no goal is supplied", () => {
    expect(buildIdeationPrompt(base)).toBe(
      buildIdeationPrompt({ ...base, goal: null }),
    );
    expect(buildIdeationPrompt(base)).not.toContain("Client goal:");
  });

  it("prepends exactly one goal line when a goal is supplied", () => {
    const out = buildIdeationPrompt({
      ...base,
      goal: { title: "Grow saves", hypothesis: "Educational hooks win" },
    });
    expect(out.startsWith("Client goal: Grow saves.")).toBe(true);
    expect(out).toContain("Hypothesis under test: Educational hooks win.");
  });

  it("omits the hypothesis clause when the goal has none", () => {
    const out = buildIdeationPrompt({
      ...base,
      goal: { title: "Grow saves", hypothesis: null },
    });
    expect(out.startsWith("Client goal: Grow saves.")).toBe(true);
    expect(out).not.toContain("Hypothesis under test:");
  });
});

describe("combineIdeas", () => {
  it("throws error when fewer than 2 ideas are provided", async () => {
    await expect(
      combineIdeas({ ideas: [{ topic: "T1", hook: "H1" }], identity: IDENTITY }),
    ).rejects.toThrow("Select at least 2 ideas to combine.");
  });

  it("calls routeAI and parses combined response", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        topic: "Combined Topic",
        hook: "Combined Hook",
        angle: "Combined Angle",
        format: "reel",
        reason: "Merged concepts strategically",
      }),
    );

    const out = await combineIdeas({
      ideas: [
        { topic: "Topic 1", hook: "Hook 1" },
        { topic: "Topic 2", hook: "Hook 2" },
      ],
      identity: IDENTITY,
    });

    expect(out.hook).toBe("Combined Hook");
    expect(out.why.reason).toBe("Merged concepts strategically");
  });
});
