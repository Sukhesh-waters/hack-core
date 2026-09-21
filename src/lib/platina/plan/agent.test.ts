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
  patternEvidence: [],
  baselineEvidence: [],
  coldStart: true,
  evidenceStatus: "empty_brain",
  scopeLabel: null,
  clientProfile: null,
  anchor: null,
  revisionOf: null,
};

const WARM: PlanContext = {
  ...COLD,
  coldStart: false,
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

describe("planner evidence (core spine S6)", () => {
  const evidence = (id: string, plane: "A" | "B", content: string) => ({
    id,
    plane,
    content,
    sourceUrl: plane === "B" ? "https://rival.com/news" : null,
    collectedAt: new Date("2026-09-18T00:00:00Z"),
    confidence: 0.8,
  });
  const GROUNDED: PlanContext = {
    ...COLD,
    coldStart: false,
    patternEvidence: [evidence("b1", "B", "PUBLIC-CLAIM rivals push instant results")],
    baselineEvidence: [evidence("a1", "A", "FIRSTPARTY-FACT email is our best channel")],
  };

  it("renders the two planes as separate labelled blocks — never mixed", () => {
    const prompt = buildPlanPrompt(GROUNDED);
    const blocks = prompt.split("\n\n");
    const publicBlock = blocks.find((b) => b.startsWith("Public market evidence"))!;
    const firstPartyBlock = blocks.find((b) => b.startsWith("First-party baseline evidence"))!;
    expect(publicBlock).toContain("[b1]");
    expect(publicBlock).not.toContain("[a1]");
    expect(publicBlock).not.toContain("FIRSTPARTY-FACT");
    expect(firstPartyBlock).toContain("[a1]");
    expect(firstPartyBlock).not.toContain("[b1]");
    expect(firstPartyBlock).not.toContain("PUBLIC-CLAIM");
  });

  it("tells the model to cite one plane per phase", () => {
    expect(buildPlanPrompt(GROUNDED)).toContain("ONE evidence list only");
  });

  it("omits the first-party block entirely when there is none, and admits no evidence on a cold start", () => {
    const cold = buildPlanPrompt(COLD);
    expect(cold).not.toContain("First-party baseline evidence");
    expect(cold).toContain("There is no collected evidence");
  });

  it("keeps the evidence in the prompt identical whichever provider answers", async () => {
    routeAIMock.mockResolvedValue(planJson());
    await generateCampaignPlan(GROUNDED);
    expect(routeAIMock.mock.calls[0][0].prompt).toBe(buildPlanPrompt(GROUNDED));
  });

  it("stores a frozen evidence snapshot and the cold-start flag on the plan", async () => {
    routeAIMock.mockResolvedValue(
      planJson([{ ...PHASES[1], evidenceIds: ["b1"] }, PHASES[0]]),
    );
    const plan = await generateCampaignPlan(GROUNDED);
    expect(plan.doc.coldStart).toBe(false);
    expect(plan.doc.evidence?.map((e) => e.id)).toEqual(["b1", "a1"]);
    expect(plan.doc.phases.find((p) => p.name === "Prep")?.evidenceIds).toEqual(["b1"]);
    expect(plan.doc.phases.find((p) => p.name === "Build audience")?.evidenceIds).toBeUndefined();
  });

  it("marks a plan built from nothing as a cold start", async () => {
    routeAIMock.mockResolvedValue(planJson());
    expect((await generateCampaignPlan(COLD)).doc.coldStart).toBe(true);
  });

  it("rejects a plan that cites evidence it was never shown", async () => {
    routeAIMock.mockResolvedValue(planJson([{ ...PHASES[1], evidenceIds: ["ghost"] }]));
    const plan = await generateCampaignPlan(GROUNDED);
    expect(validatePlan(plan, GROUNDED)).toMatchObject({ valid: false });
  });

  it("rejects a phase that mixes public and first-party evidence", async () => {
    routeAIMock.mockResolvedValue(planJson([{ ...PHASES[1], evidenceIds: ["a1", "b1"] }]));
    const plan = await generateCampaignPlan(GROUNDED);
    expect(validatePlan(plan, GROUNDED)).toMatchObject({ valid: false });
  });

  it("accepts a plan that cites real evidence from one plane", async () => {
    routeAIMock.mockResolvedValue(planJson([{ ...PHASES[1], evidenceIds: ["b1"] }]));
    const plan = await generateCampaignPlan(GROUNDED);
    expect(validatePlan(plan, GROUNDED)).toEqual({ valid: true });
  });
});

describe("real-time planning: situation, anchor and revision", () => {
  const ANCHORED: PlanContext = { ...COLD, anchor: { label: "Roast Day (day 30)", day: 30 }, scopeLabel: "Northwind" };
  const REVISING: PlanContext = {
    ...COLD,
    revisionOf: {
      title: "Holiday push",
      summary: "Social first, then email.",
      phases: ["Days 1-14 · Social · Story", "Days 15-42 · Email · Offer"],
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
    patternEvidence: [
      { id: "new1", plane: "B", content: "Rival cut prices", sourceUrl: null, collectedAt: null, confidence: 0.8, isNew: true },
      { id: "old1", plane: "B", content: "Rival launched a blend", sourceUrl: null, collectedAt: null, confidence: 0.8 },
    ],
    coldStart: false,
  };

  it("tells the planner the client and the fixed date to plan backwards from", () => {
    const prompt = buildPlanPrompt(ANCHORED);
    expect(prompt).toContain('client "Northwind"');
    expect(prompt).toContain("falls on day 30");
    expect(prompt).toContain("at least one phase cover day 30");
  });

  it("rejects a plan that never covers the fixed date", () => {
    const miss: GeneratedPlan = {
      title: "t",
      doc: { summary: "s", totalDays: 20, phases: [{ id: "p1", name: "Early", startDay: 1, endDay: 20, channel: "Email", message: "m" }] },
    };
    expect(validatePlan(miss, ANCHORED)).toMatchObject({ valid: false });
    const hit: GeneratedPlan = {
      title: "t",
      doc: { summary: "s", totalDays: 34, phases: [{ id: "p1", name: "Peak", startDay: 25, endDay: 34, channel: "Email", message: "m" }] },
    };
    expect(validatePlan(hit, ANCHORED)).toEqual({ valid: true });
  });

  it("shows the earlier plan and flags only the evidence that arrived since", () => {
    const prompt = buildPlanPrompt(REVISING);
    expect(prompt).toContain('The earlier plan was "Holiday push"');
    expect(prompt).toContain("Days 15-42 · Email · Offer");
    expect(prompt).toContain("[new1] NEW ");
    expect(prompt).not.toContain("[old1] NEW ");
    expect(prompt).toContain('"revisionNote":string');
  });

  it("does not ask for a revisionNote outside a revision", () => {
    expect(buildPlanPrompt(COLD)).not.toContain("revisionNote");
  });

  it("keeps the revision note only when revising, and records why the evidence was thin", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({ title: "Holiday push v2", summary: "Adjusted for the price cut.", revisionNote: "Moved the offer earlier.", phases: PHASES }),
    );
    const revised = await generateCampaignPlan(REVISING);
    expect(revised.doc.revisionNote).toBe("Moved the offer earlier.");
    const fresh = await generateCampaignPlan(COLD);
    expect(fresh.doc.revisionNote).toBeUndefined();
    expect(fresh.doc.evidenceStatus).toBe("empty_brain");
  });

  it("keeps the first five review notes instead of voiding a verbose review", async () => {
    const plan: GeneratedPlan = { title: "t", doc: { summary: "s", totalDays: 7, phases: [{ id: "p1", name: "P", startDay: 1, endDay: 7, channel: "Email", message: "m" }] } };
    routeAIMock.mockResolvedValue(
      JSON.stringify({ verdict: "flagged", feedback: ["one note", "two note", "three note", "four note", "five note", "six note", "seven note"] }),
    );
    const result = await critiquePlan(plan, COLD);
    expect(result.feedback).toEqual(["one note", "two note", "three note", "four note", "five note"]);
  });

  it("drops empty review notes but still fails on non-JSON", async () => {
    const plan: GeneratedPlan = { title: "t", doc: { summary: "s", totalDays: 7, phases: [{ id: "p1", name: "P", startDay: 1, endDay: 7, channel: "Email", message: "m" }] } };
    routeAIMock.mockResolvedValue(JSON.stringify({ verdict: "flagged", feedback: ["", "  ", "a real concern"] }));
    expect((await critiquePlan(plan, COLD)).feedback).toEqual(["a real concern"]);
    routeAIMock.mockResolvedValue("nope");
    await expect(critiquePlan(plan, COLD)).rejects.toBeInstanceOf(PlanError);
  });
});
