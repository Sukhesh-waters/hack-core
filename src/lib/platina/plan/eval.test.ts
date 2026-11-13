import { describe, expect, it } from "vitest";
import { AIRouterError } from "@/lib/ai/router";
import { validatePlan, type GeneratedPlan } from "./agent";
import { findCitationProblem } from "./evidence";
import { CRITIC_EVAL_SET, PLAN_EVAL_CASES } from "./eval-set";
import {
  PLAN_CHECKS,
  checkPlan,
  compareToBaseline,
  inventedFigures,
  runPlanEval,
  summarise,
} from "./eval";

const caseById = (id: string) => PLAN_EVAL_CASES.find((c) => c.id === id)!;

function plan(phases: GeneratedPlan["doc"]["phases"], extra: Partial<GeneratedPlan["doc"]> = {}): GeneratedPlan {
  return {
    title: "Test plan",
    doc: {
      summary: "A test plan.",
      totalDays: Math.max(...phases.map((p) => p.endDay)),
      phases,
      falsifier: { metric: "creative_engagement_rate", direction: "below", threshold: 0.02, window_days: 30 },
      ...extra,
    },
  };
}

const phase = (id: string, startDay: number, endDay: number, evidenceIds?: string[]) => ({
  id,
  name: `Phase ${id}`,
  startDay,
  endDay,
  channel: "LinkedIn",
  message: "Show the workflow to lab managers.",
  ...(evidenceIds ? { evidenceIds } : {}),
});

describe("plan test set integrity", () => {
  it("has unique case ids and unique evidence ids within each case", () => {
    const ids = PLAN_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of PLAN_EVAL_CASES) {
      const evidence = [
        ...c.context.patternEvidence,
        ...c.context.baselineEvidence,
        ...(c.context.counterEvidence ? [c.context.counterEvidence] : []),
      ].map((e) => e.id);
      expect(new Set(evidence).size, c.id).toBe(evidence.length);
    }
  });

  it("contains no client or competitor names from live workspaces", () => {
    const text = JSON.stringify([PLAN_EVAL_CASES, CRITIC_EVAL_SET]).toLowerCase();
    for (const name of ["waters", "thermo", "agilent", "shimadzu", "sciex", "bruker", "arablab"]) {
      expect(text, name).not.toContain(name);
    }
  });

  it("keeps briefs within the brief rules and anchors inside the plan limit", () => {
    for (const c of PLAN_EVAL_CASES) {
      expect(c.context.brief.length).toBeGreaterThanOrEqual(10);
      expect(c.context.brief.length).toBeLessThanOrEqual(400);
      expect(c.context.brief.split("\n").length).toBeLessThanOrEqual(2);
      if (c.context.anchor) expect(c.context.anchor.day).toBeLessThanOrEqual(180);
    }
  });

  it("has critic items for both verdicts", () => {
    expect(CRITIC_EVAL_SET.some((i) => i.expected === "pass")).toBe(true);
    expect(CRITIC_EVAL_SET.some((i) => i.expected === "flagged")).toBe(true);
  });
});

describe("checkPlan", () => {
  it("passes a clean plan on every check that applies", () => {
    const c = caseById("public-only");
    const checks = checkPlan(plan([phase("p1", 1, 10, ["b-1"]), phase("p2", 11, 20), phase("p3", 21, 30, ["b-2"])]), c.context);
    expect(Object.values(checks).every(Boolean)).toBe(true);
    expect(checks.anchor_covered).toBeUndefined();
    expect(checks.revision_note).toBeUndefined();
  });

  it("fails an invented citation and a mixed-plane phase, agreeing with the orchestrator's check", () => {
    const c = caseById("two-planes");
    const ghost = plan([phase("p1", 1, 10, ["ghost"]), phase("p2", 11, 20), phase("p3", 21, 30)]);
    const mixed = plan([phase("p1", 1, 10, ["a-1", "b-1"]), phase("p2", 11, 20), phase("p3", 21, 30)]);
    expect(checkPlan(ghost, c.context).citations_known).toBe(false);
    expect(checkPlan(mixed, c.context).one_plane_per_phase).toBe(false);
    expect(findCitationProblem(ghost.doc.phases, c.context.patternEvidence.concat(c.context.baselineEvidence))).not.toBeNull();
    expect(validatePlan(mixed, c.context).valid).toBe(false);
  });

  it("scores the fixed date: covered, and finished within a week after", () => {
    const c = caseById("anchor-near");
    const good = checkPlan(plan([phase("p1", 1, 10), phase("p2", 11, 21), phase("p3", 22, 28)]), c.context);
    const late = checkPlan(plan([phase("p1", 1, 10), phase("p2", 11, 21), phase("p3", 22, 60)]), c.context);
    const missed = checkPlan(plan([phase("p1", 1, 5), phase("p2", 6, 10), phase("p3", 25, 28)]), c.context);
    expect([good.anchor_covered, good.anchor_finish]).toEqual([true, true]);
    expect(late.anchor_finish).toBe(false);
    expect(missed.anchor_covered).toBe(false);
  });

  it("fails any citation in a case with no evidence", () => {
    const c = caseById("cold-start");
    const checks = checkPlan(plan([phase("p1", 1, 10, ["b-1"]), phase("p2", 11, 20), phase("p3", 21, 30)]), c.context);
    expect(checks.no_citations_without_evidence).toBe(false);
  });

  it("needs a revision note on a revision and a stated test everywhere", () => {
    const c = caseById("revision");
    const checks = checkPlan(
      plan([phase("p1", 1, 10), phase("p2", 11, 20), phase("p3", 21, 30)], { falsifier: undefined }),
      c.context,
    );
    expect(checks.revision_note).toBe(false);
    expect(checks.stated_test).toBe(false);
  });

  it("fails too few phases and a plan past 180 days", () => {
    const c = caseById("public-only");
    expect(checkPlan(plan([phase("p1", 1, 10)]), c.context).phase_count).toBe(false);
    expect(checkPlan(plan([phase("p1", 1, 10), phase("p2", 11, 20), phase("p3", 21, 200)]), c.context).days_in_range).toBe(false);
  });
});

describe("inventedFigures", () => {
  it("flags percentages and money the planner was never shown", () => {
    const c = caseById("lessons");
    const p = plan([{ ...phase("p1", 1, 10), message: "Lift sign-ups by 40% with a $500 boost." }]);
    expect(inventedFigures(p, c.context)).toEqual(["40%", "$500"]);
  });

  it("allows a figure quoted from the evidence", () => {
    const c = {
      ...caseById("public-only").context,
      patternEvidence: [{ ...caseById("public-only").context.patternEvidence[0]!, content: "Posts rose 25% this month." }],
    };
    expect(inventedFigures(plan([{ ...phase("p1", 1, 10), message: "Posts rose 25% this month." }]), c)).toEqual([]);
  });
});

describe("runPlanEval", () => {
  it("scores every case, counts a generation failure, and reports rates with N", async () => {
    const report = await runPlanEval({
      cases: PLAN_EVAL_CASES.slice(0, 2),
      generate: async (context) => {
        if (context.coldStart) throw new Error("unusable");
        return plan([phase("p1", 1, 10), phase("p2", 11, 20), phase("p3", 21, 30)]);
      },
      runs: 2,
    });
    expect(report.cases).toHaveLength(4);
    expect(report.byCheck.generated).toEqual({ passed: 2, applicable: 4, rate: 0.5 });
    expect(report.byCheck.stated_test).toEqual({ passed: 2, applicable: 2, rate: 1 });
    expect(report.byCheck.anchor_covered.rate).toBeNull();
    expect(report.critic).toBeNull();
  });

  it("leaves provider outages unscored instead of failing the planner or critic", async () => {
    const outage = () => new AIRouterError("every AI provider failed: gemini — last error: fetch failed", "gemini");
    const report = await runPlanEval({
      cases: PLAN_EVAL_CASES.slice(0, 2),
      generate: async () => {
        throw outage();
      },
      critique: async () => {
        throw outage();
      },
      criticSet: CRITIC_EVAL_SET.slice(0, 1),
    });
    expect(report.unavailable).toBe(3);
    expect(report.byCheck.generated).toEqual({ passed: 0, applicable: 0, rate: null });
    expect(report.critic?.agreement.rate).toBeNull();
  });

  it("measures the critic's agreement with the person's verdict", async () => {
    const report = await runPlanEval({
      cases: [],
      generate: async () => plan([phase("p1", 1, 10)]),
      critique: async () => ({ verdict: "pass", feedback: [] }),
      criticSet: CRITIC_EVAL_SET,
    });
    const passes = CRITIC_EVAL_SET.filter((i) => i.expected === "pass").length;
    expect(report.critic?.agreement).toEqual({ passed: passes, applicable: CRITIC_EVAL_SET.length, rate: passes / CRITIC_EVAL_SET.length });
  });
});

describe("compareToBaseline", () => {
  const report = (rate: number) => ({
    byCheck: summarise([]),
    critic: { results: [], agreement: { passed: 0, applicable: 1, rate } },
  });

  it("reports a drop below the baseline and ignores unscored checks", () => {
    const base = report(0.75);
    base.byCheck.stated_test = { passed: 8, applicable: 8, rate: 1 };
    const now = report(0.5);
    now.byCheck.stated_test = { passed: 7, applicable: 8, rate: 0.875 };
    expect(compareToBaseline(now, base).map((d) => d.check)).toEqual(["stated_test", "critic_agreement"]);
    expect(compareToBaseline(now, base, 0.3)).toEqual([]);
  });

  it("covers every check name", () => {
    expect(Object.keys(summarise([]))).toEqual([...PLAN_CHECKS]);
  });
});
