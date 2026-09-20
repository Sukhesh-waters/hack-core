import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buildPlanCritiquePrompt,
  buildPlanPrompt,
  critiquePlan,
  generateCampaignPlan,
  PlanError,
  validatePlan,
  type GeneratedPlan,
} from "./agent";
import type { PlanContext } from "./context";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

const COLD: PlanContext = {
  brief: "Launch our espresso subscription.\nTarget: home baristas.",
  worked: [],
  failed: [],
};

const WARM: PlanContext = {
  ...COLD,
  worked: [
    {
      title: "Spring email push",
      brief: "Spring promo",
      summary: "Drip email to existing list. Channels: Email.",
      note: "Best open rates so far",
    },
  ],
  failed: [
    {
      title: "Paid burst",
      brief: "Summer promo",
      summary: "Heavy paid ads up front. Channels: Paid ads.",
      note: "Spent the budget in week one",
    },
  ],
};

const PHASES = [
  { name: "Build audience", startDay: 8, endDay: 21, channel: "Social", message: "Post behind the scenes." },
  { name: "Prep", startDay: 1, endDay: 7, channel: "Email", message: "Warm the list." },
];

function planJson(phases: unknown[] = PHASES) {
  return JSON.stringify({
    title: "Espresso subscription launch",
    summary: "A short prep, then social to build the audience.",
    phases,
  });
}

beforeEach(() => routeAIMock.mockReset());

describe("buildPlanPrompt", () => {
  it("admits a cold start instead of implying past evidence", () => {
    const prompt = buildPlanPrompt(COLD);
    expect(prompt).toContain("No results have been logged");
    expect(prompt).toContain("What worked before: none recorded yet.");
  });

  it("feeds recorded lessons, worked and failed, into the prompt", () => {
    const prompt = buildPlanPrompt(WARM);
    expect(prompt).toContain("Spring email push");
    expect(prompt).toContain("Best open rates so far");
    expect(prompt).toContain("Paid burst");
    expect(prompt).toContain("Spent the budget in week one");
    expect(prompt).not.toContain("No results have been logged");
  });
});

describe("generateCampaignPlan", () => {
  it("runs on the quality tier, sorts phases by start day and assigns ids", async () => {
    routeAIMock.mockResolvedValue(planJson());

    const plan = await generateCampaignPlan(COLD);

    expect(routeAIMock.mock.calls[0][0]).toMatchObject({ kind: "chat", tier: "quality", json: true });
    expect(plan.doc.phases.map((p) => [p.id, p.name])).toEqual([
      ["p1", "Prep"],
      ["p2", "Build audience"],
    ]);
    expect(plan.doc.totalDays).toBe(21);
  });

  it("throws PlanError on malformed output", async () => {
    routeAIMock.mockResolvedValue("not json");
    await expect(generateCampaignPlan(COLD)).rejects.toBeInstanceOf(PlanError);
  });

  it("rejects an out-of-schema phase (no phases at all)", async () => {
    routeAIMock.mockResolvedValue(planJson([]));
    await expect(generateCampaignPlan(COLD)).rejects.toBeInstanceOf(PlanError);
  });
});

describe("validatePlan", () => {
  const base = (over: Partial<GeneratedPlan["doc"]["phases"][number]> = {}, totalDays = 21): GeneratedPlan => ({
    title: "t",
    doc: {
      summary: "s",
      totalDays,
      phases: [
        { id: "p1", name: "Prep", startDay: 1, endDay: 7, channel: "Email", message: "m", ...over },
      ],
    },
  });

  it("accepts a sound plan", () => {
    expect(validatePlan(base())).toEqual({ valid: true });
  });

  it("rejects a phase that ends before it starts", () => {
    expect(validatePlan(base({ startDay: 9, endDay: 3 })).valid).toBe(false);
  });

  it("rejects a plan longer than the cap", () => {
    expect(validatePlan(base({}, 400)).valid).toBe(false);
  });
});

describe("critiquePlan", () => {
  const plan: GeneratedPlan = {
    title: "t",
    doc: { summary: "s", totalDays: 7, phases: [{ id: "p1", name: "Paid blast", startDay: 1, endDay: 7, channel: "Paid ads", message: "Spend it all" }] },
  };

  it("shows the critic the tactics that failed before, so it can flag a repeat", () => {
    const prompt = buildPlanCritiquePrompt(plan, WARM);
    expect(prompt).toContain("Paid burst");
    expect(prompt).toContain("any repeat of a tactic that failed before");
  });

  it("returns a flagged verdict with feedback", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({ verdict: "flagged", feedback: ["Repeats the paid burst that failed."] }),
    );
    const result = await critiquePlan(plan, WARM);
    expect(result.verdict).toBe("flagged");
    expect(routeAIMock.mock.calls[0][0]).toMatchObject({ tier: "fast", json: true });
  });

  it("rejects unusable review output", async () => {
    routeAIMock.mockResolvedValue("nope");
    await expect(critiquePlan(plan, WARM)).rejects.toBeInstanceOf(PlanError);
  });
});
