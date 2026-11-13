/**
 * CORE-3 plan evaluation: code checks over generated plans, and the critic's
 * agreement with a person's verdict. Pure — the generator and critic are
 * passed in, so the same runner scores the live planner (script) and fakes
 * (tests).
 *
 * Gate rule (roadmap 2026-10-23): a prompt or model change to the planner or
 * critic merges only with a report that does not drop below the recorded
 * baseline (`compareToBaseline`).
 */
import { AIRouterError } from "@/lib/ai/router";
import { MAX_PLAN_DAYS, type GeneratedPlan, type PlanCritique } from "./agent";
import type { PlanContext, PlanEvidence } from "./context";
import type { CriticEvalItem, PlanEvalCase } from "./eval-set";

export const PLAN_CHECKS = [
  "generated",
  "citations_known",
  "one_plane_per_phase",
  "days_in_range",
  "phase_count",
  "stated_test",
  "anchor_covered",
  "anchor_finish",
  "no_citations_without_evidence",
  "revision_note",
  "no_invented_figures",
] as const;
export type PlanCheck = (typeof PLAN_CHECKS)[number];

export const MIN_PHASES = 3;
export const MAX_PHASES = 6;

export type CaseResult = {
  caseId: string;
  run: number;
  error?: string;
  /** No provider answered: says nothing about the planner, so nothing is scored. */
  unavailable?: boolean;
  /** Only the checks that apply to this case; absent = not applicable. */
  checks: Partial<Record<PlanCheck, boolean>>;
};

export type CheckRate = { passed: number; applicable: number; rate: number | null };

export type CriticResult = {
  itemId: string;
  expected: "pass" | "flagged";
  got: "pass" | "flagged" | "error" | "unavailable";
  error?: string;
};

export type PlanEvalReport = {
  runs: number;
  cases: CaseResult[];
  /** Plan cases and critic items not scored because no provider answered. */
  unavailable: number;
  byCheck: Record<PlanCheck, CheckRate>;
  critic: { results: CriticResult[]; agreement: CheckRate } | null;
};

const isOutage = (error: unknown) => error instanceof AIRouterError;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function shown(context: PlanContext): PlanEvidence[] {
  return [
    ...context.patternEvidence,
    ...context.baselineEvidence,
    ...(context.counterEvidence ? [context.counterEvidence] : []),
  ];
}

/** Percentages and money amounts written in the plan but absent from what the planner was shown. */
export function inventedFigures(plan: GeneratedPlan, context: PlanContext): string[] {
  const source = [context.brief, ...shown(context).map((e) => e.content), ...(context.learnedPatterns ?? [])]
    .join(" ")
    .toLowerCase();
  const text = [plan.doc.summary, ...plan.doc.phases.map((p) => p.message)].join(" ");
  const figures = text.match(/(?:[$€£₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:%|percent\b|usd\b|aed\b|sar\b|inr\b|eur\b))/gi) ?? [];
  return figures.filter((f) => !source.includes(f.toLowerCase()));
}

/** Every check that applies to this case, scored on one generated plan. */
export function checkPlan(plan: GeneratedPlan, context: PlanContext): Partial<Record<PlanCheck, boolean>> {
  const phases = plan.doc.phases;
  const evidence = shown(context);
  const cited = phases.flatMap((p) => p.evidenceIds ?? []);
  const planeOf = new Map(evidence.map((e) => [e.id, e.plane] as const));
  const checks: Partial<Record<PlanCheck, boolean>> = {
    generated: true,
    citations_known: cited.every((id) => planeOf.has(id)),
    one_plane_per_phase: phases.every((p) => new Set((p.evidenceIds ?? []).map((id) => planeOf.get(id))).size <= 1),
    days_in_range:
      phases.every((p) => p.startDay >= 1 && p.endDay >= p.startDay) && plan.doc.totalDays <= MAX_PLAN_DAYS,
    phase_count: phases.length >= MIN_PHASES && phases.length <= MAX_PHASES,
    stated_test: Boolean(plan.doc.falsifier),
    no_invented_figures: inventedFigures(plan, context).length === 0,
  };
  if (context.anchor) {
    const day = context.anchor.day;
    checks.anchor_covered = phases.some((p) => p.startDay <= day && day <= p.endDay);
    checks.anchor_finish = plan.doc.totalDays <= Math.min(MAX_PLAN_DAYS, day + 7);
  }
  if (evidence.length === 0) checks.no_citations_without_evidence = cited.length === 0;
  if (context.revisionOf) checks.revision_note = Boolean(plan.doc.revisionNote?.trim());
  return checks;
}

function rate(passed: number, applicable: number): CheckRate {
  return { passed, applicable, rate: applicable === 0 ? null : passed / applicable };
}

export function summarise(cases: CaseResult[]): Record<PlanCheck, CheckRate> {
  const out = {} as Record<PlanCheck, CheckRate>;
  for (const check of PLAN_CHECKS) {
    const scored = cases.map((c) => c.checks[check]).filter((v): v is boolean => v !== undefined);
    out[check] = rate(scored.filter(Boolean).length, scored.length);
  }
  return out;
}

export async function runPlanEval(input: {
  cases: PlanEvalCase[];
  generate: (context: PlanContext) => Promise<GeneratedPlan>;
  critique?: (plan: GeneratedPlan, context: PlanContext) => Promise<PlanCritique>;
  criticSet?: CriticEvalItem[];
  runs?: number;
}): Promise<PlanEvalReport> {
  const runs = Math.max(1, input.runs ?? 1);
  const cases: CaseResult[] = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const c of input.cases) {
      try {
        const plan = await input.generate(c.context);
        cases.push({ caseId: c.id, run, checks: checkPlan(plan, c.context) });
      } catch (error) {
        // An unusable plan fails "generated"; an outage is not scored at all.
        cases.push(
          isOutage(error)
            ? { caseId: c.id, run, error: message(error), unavailable: true, checks: {} }
            : { caseId: c.id, run, error: message(error), checks: { generated: false } },
        );
      }
    }
  }

  let critic: PlanEvalReport["critic"] = null;
  if (input.critique && input.criticSet && input.criticSet.length > 0) {
    const results: CriticResult[] = [];
    for (let run = 1; run <= runs; run += 1) {
      for (const item of input.criticSet) {
        try {
          const review = await input.critique(item.plan, item.context);
          results.push({ itemId: item.id, expected: item.expected, got: review.verdict });
        } catch (error) {
          results.push({
            itemId: item.id,
            expected: item.expected,
            got: isOutage(error) ? "unavailable" : "error",
            error: message(error),
          });
        }
      }
    }
    const scored = results.filter((r) => r.got !== "unavailable");
    critic = {
      results,
      agreement: rate(scored.filter((r) => r.got === r.expected).length, scored.length),
    };
  }

  const unavailable =
    cases.filter((c) => c.unavailable).length +
    (critic?.results.filter((r) => r.got === "unavailable").length ?? 0);
  return { runs, cases, unavailable, byCheck: summarise(cases), critic };
}

export type BaselineDrop = { check: PlanCheck | "critic_agreement"; baseline: number; current: number };

/** Checks whose pass rate fell more than `tolerance` below the baseline. Unscored rates are skipped. */
export function compareToBaseline(
  current: Pick<PlanEvalReport, "byCheck" | "critic">,
  baseline: Pick<PlanEvalReport, "byCheck" | "critic">,
  tolerance = 0,
): BaselineDrop[] {
  const drops: BaselineDrop[] = [];
  for (const check of PLAN_CHECKS) {
    const was = baseline.byCheck[check]?.rate;
    const now = current.byCheck[check]?.rate;
    if (was == null || now == null) continue;
    if (now < was - tolerance) drops.push({ check, baseline: was, current: now });
  }
  const wasCritic = baseline.critic?.agreement.rate;
  const nowCritic = current.critic?.agreement.rate;
  if (wasCritic != null && nowCritic != null && nowCritic < wasCritic - tolerance) {
    drops.push({ check: "critic_agreement", baseline: wasCritic, current: nowCritic });
  }
  return drops;
}
