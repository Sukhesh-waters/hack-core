import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  CRITIC_UNAVAILABLE_FEEDBACK,
  runCampaignStrategy,
  validateCampaignStrategy,
} from "./campaign-strategy";
import {
  clientBrandContext,
  recentCompetitorAds,
} from "@/db/queries/ad-intelligence";
import { routeAI } from "@/lib/ai/router";

// Only the two true boundaries are mocked (DB + model router); the recipe,
// Strategy agent, validation, Critic, and orchestrator all run for real.
vi.mock("@/db/queries/ad-intelligence", () => ({
  clientBrandContext: vi.fn(),
  recentCompetitorAds: vi.fn(),
  topAdEligibleContent: vi.fn(),
}));
vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));

const brandMock = clientBrandContext as unknown as Mock;
const adsMock = recentCompetitorAds as unknown as Mock;
const routeAIMock = routeAI as unknown as Mock;

const STRATEGY = {
  recommendedObjective: "traffic" as const,
  recommendedBudgetRange: { min: 200, max: 500 },
  audienceSuggestion: "Coffee enthusiasts 25-45 into single origin",
  adCopyVariants: ["Roasted this week. See the date on every bag."],
  strategySummary: "Lead with verifiable freshness against stale competitors.",
  keyRisks: ["Cold audience may not grasp roast dates"],
};

/** Strategy agent and Critic both call routeAI; tell them apart by system prompt. */
function mockModel(opts: {
  strategy?: unknown;
  critique?: unknown;
  critiqueThrows?: boolean;
}) {
  routeAIMock.mockImplementation(async (task: { system?: string }) => {
    if (task.system?.includes("independent paid-media reviewer")) {
      if (opts.critiqueThrows) throw new Error("provider down");
      return JSON.stringify(opts.critique ?? { verdict: "pass", feedback: [] });
    }
    return JSON.stringify(opts.strategy ?? STRATEGY);
  });
}

beforeEach(() => {
  brandMock.mockReset();
  adsMock.mockReset();
  routeAIMock.mockReset();
  brandMock.mockResolvedValue({ name: "FreshRoast Coffee", handle: "freshroast" });
  adsMock.mockResolvedValue([
    {
      id: "pad_1",
      pageHandle: "competitor_a",
      adBody: "Stop buying stale coffee",
      adFormat: "video_reel",
      targetAudience: "Coffee lovers",
      postedAt: new Date("2026-08-01"),
    },
  ]);
});

describe("validateCampaignStrategy", () => {
  it("rejects an inverted budget range", () => {
    const result = validateCampaignStrategy({
      ...STRATEGY,
      recommendedBudgetRange: { min: 900, max: 100 },
    });
    expect(result.valid).toBe(false);
    expect(validateCampaignStrategy(STRATEGY)).toEqual({ valid: true });
  });
});

describe("runCampaignStrategy (input → context → agent → validation → critic → output)", () => {
  it("completes end to end and feeds the real assembled context to the agent", async () => {
    mockModel({});

    const result = await runCampaignStrategy({
      workspaceId: "ws_1",
      clientId: "c_1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.strategy.recommendedObjective).toBe("traffic");
    expect(result.output.criticFeedback).toEqual([]);

    // Workspace scoping reached the DB boundary.
    expect(brandMock).toHaveBeenCalledWith("ws_1", "c_1");
    expect(adsMock).toHaveBeenCalledWith("ws_1");

    // The Strategy agent saw the assembled brand + market context.
    const strategyCall = routeAIMock.mock.calls.find(
      ([t]) => !t.system?.includes("independent paid-media reviewer"),
    )![0];
    expect(strategyCall.prompt).toContain("FreshRoast Coffee");
    expect(strategyCall.prompt).toContain("Stop buying stale coffee");

    // Critic ran as a separate, second model call.
    expect(routeAIMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces Critic feedback when the strategy is flagged", async () => {
    mockModel({
      critique: {
        verdict: "flagged",
        feedback: ["Budget too thin for the stated objective."],
      },
    });

    const result = await runCampaignStrategy({
      workspaceId: "ws_1",
      clientId: "c_1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.criticFeedback).toEqual([
      "Budget too thin for the stated objective.",
    ]);
  });

  it("a failed Critic call is surfaced as feedback, never silently skipped", async () => {
    mockModel({ critiqueThrows: true });

    const result = await runCampaignStrategy({
      workspaceId: "ws_1",
      clientId: "c_1",
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.criticFeedback).toEqual([CRITIC_UNAVAILABLE_FEEDBACK]);
  });

  it("rejects an invalid proposal before the Critic is ever called", async () => {
    mockModel({
      strategy: { ...STRATEGY, recommendedBudgetRange: { min: 900, max: 100 } },
    });

    const result = await runCampaignStrategy({
      workspaceId: "ws_1",
      clientId: "c_1",
    });

    expect(result.status).toBe("invalid_proposal");
    expect(routeAIMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a malformed Strategy agent response instead of inventing output", async () => {
    routeAIMock.mockResolvedValue("not json");

    await expect(
      runCampaignStrategy({ workspaceId: "ws_1", clientId: "c_1" }),
    ).rejects.toThrow();
  });
});
