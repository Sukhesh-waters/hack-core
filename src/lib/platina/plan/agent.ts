import { z } from "zod";
import type { PlanDoc } from "@/db/platina-schema";
import { routeAI } from "@/lib/ai/router";
import type { ValidationResult } from "@/lib/orchestrator/run";
import type { PlanContext, PlanLesson } from "@/lib/platina/plan/context";

export const MAX_PLAN_DAYS = 180;

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export type GeneratedPlan = { title: string; doc: PlanDoc };

const phaseSchema = z.object({
  name: z.string().trim().min(2).max(60),
  startDay: z.number().int().min(1).max(365),
  endDay: z.number().int().min(1).max(365),
  channel: z.string().trim().min(2).max(40),
  message: z.string().trim().min(3).max(200),
});

const planResponseSchema = z.object({
  title: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(10).max(300),
  phases: z.array(phaseSchema).min(1).max(8),
});

function renderLessons(label: string, lessons: PlanLesson[]): string {
  if (lessons.length === 0) return `${label}: none recorded yet.`;
  return [
    `${label}:`,
    ...lessons.map(
      (l) =>
        `- "${l.title}" (brief: ${l.brief.replace(/\s+/g, " ")}). ${l.summary}${l.note ? ` Team note: ${l.note}` : ""}`,
    ),
  ].join("\n");
}

export function buildPlanPrompt(context: PlanContext): string {
  const cold = context.worked.length + context.failed.length === 0;
  return [
    `Campaign brief:\n${context.brief}`,
    cold
      ? "No results have been logged for this workspace yet, so plan from the brief alone and do not claim past evidence."
      : "Lessons from this workspace's earlier plans. Reuse what worked, and do not repeat what failed unless you change the approach and say why in the message.",
    renderLessons("What worked before", context.worked),
    renderLessons("What failed before", context.failed),
    `Write a phased campaign plan with 3-6 phases on a day timeline (day 1 = launch prep, at most ${MAX_PLAN_DAYS} days in total). Each phase needs a name, startDay, endDay (endDay >= startDay), one channel, and a one-sentence message. Phases may overlap when channels run in parallel. Do not invent budgets, results or metrics.`,
    'Reply with JSON only: {"title":string,"summary":string,"phases":[{"name":string,"startDay":number,"endDay":number,"channel":string,"message":string}]}. The summary is one or two sentences.',
  ].join("\n\n");
}

/** Planner agent: proposes a plan; the orchestrator validates and persists it. */
export async function generateCampaignPlan(
  context: PlanContext,
): Promise<GeneratedPlan> {
  const raw = await routeAI({
    kind: "chat",
    tier: "quality",
    json: true,
    system:
      "You are a campaign planner. Turn a short brief into a concrete phased plan. Keep every message to one plain sentence. Never fabricate performance data.",
    prompt: buildPlanPrompt(context),
  });

  let parsed: z.infer<typeof planResponseSchema>;
  try {
    parsed = planResponseSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new PlanError(
      `The planner returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const phases = [...parsed.phases]
    .sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay)
    .map((phase, index) => ({ id: `p${index + 1}`, ...phase }));

  return {
    title: parsed.title,
    doc: {
      summary: parsed.summary,
      totalDays: Math.max(...phases.map((p) => p.endDay)),
      phases,
    },
  };
}

/** Cross-field invariants the schema cannot express. */
export function validatePlan(plan: GeneratedPlan): ValidationResult {
  const inverted = plan.doc.phases.find((p) => p.endDay < p.startDay);
  if (inverted) {
    return {
      valid: false,
      reason: `Phase "${inverted.name}" ends (day ${inverted.endDay}) before it starts (day ${inverted.startDay}).`,
    };
  }
  if (plan.doc.totalDays > MAX_PLAN_DAYS) {
    return {
      valid: false,
      reason: `The plan runs ${plan.doc.totalDays} days; the limit is ${MAX_PLAN_DAYS}.`,
    };
  }
  return { valid: true };
}

const critiqueSchema = z.object({
  verdict: z.enum(["pass", "flagged"]),
  feedback: z.array(z.string().min(3)).max(5).default([]),
});

export type PlanCritique = z.infer<typeof critiqueSchema>;

export function buildPlanCritiquePrompt(
  plan: GeneratedPlan,
  context: PlanContext,
): string {
  return [
    `Brief:\n${context.brief}`,
    "Proposed plan:",
    `Summary: ${plan.doc.summary}`,
    ...plan.doc.phases.map(
      (p) =>
        `- Days ${p.startDay}-${p.endDay} · ${p.channel} · ${p.name}: ${p.message}`,
    ),
    renderLessons(
      "Tactics that failed before in this workspace",
      context.failed,
    ),
    "Independently challenge this plan: unsupported assumptions, phases that do not serve the brief, unrealistic timing, gaps in the timeline, and any repeat of a tactic that failed before.",
    'Reply with JSON only: {"verdict":"pass"|"flagged","feedback":string[]}. verdict is "flagged" only when feedback is non-empty. Do not invent problems in a sound plan.',
  ].join("\n\n");
}

/** Critic agent: an independent challenge pass; it never rewrites the plan. */
export async function critiquePlan(
  plan: GeneratedPlan,
  context: PlanContext,
): Promise<PlanCritique> {
  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are an independent campaign reviewer. Flag only real weaknesses in the plan.",
    prompt: buildPlanCritiquePrompt(plan, context),
  });
  try {
    return critiqueSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new PlanError(
      `The plan review returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
