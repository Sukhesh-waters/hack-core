import { extractJson } from "../json";
import { z } from "zod";
import type { PlanDoc } from "@/db/platina-schema";
import { routeAI } from "@/lib/ai/router";
import type { ValidationResult } from "@/lib/orchestrator/run";
import type { PlanContext, PlanLesson } from "@/lib/platina/plan/context";
import { renderProfile } from "@/lib/platina/profile";
import {
  findCitationProblem,
  renderEvidenceBlock,
  snapshotEvidence,
} from "@/lib/platina/plan/evidence";

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
  // Ids of evidence this phase rests on, from ONE evidence list only.
  evidenceIds: z.array(z.string()).max(4).default([]),
});

const planResponseSchema = z.object({
  title: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(10).max(300),
  phases: z.array(phaseSchema).min(1).max(8),
  // Only meaningful when revising an earlier plan.
  revisionNote: z.string().trim().max(240).optional(),
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

/** Facts the plan must respect beyond the brief: a fixed date, an earlier plan. */
function renderSituation(context: PlanContext): string[] {
  const out: string[] = [];
  if (context.scopeLabel) {
    out.push(
      `This plan is for the client "${context.scopeLabel}". The market evidence below comes from that client's own sources and its competitors'.`,
    );
  }
  if (context.clientProfile) {
    out.push(
      [
        "About the client (derived from its own website; context only — do not cite it as evidence). Keep the plan consistent with how the client speaks and what it offers, and do not propose tactics that contradict its own claims or tone:",
        renderProfile(context.clientProfile),
      ].join("\n"),
    );
  }
  if (context.anchor) {
    out.push(
      `Fixed date: ${context.anchor.label} falls on day ${context.anchor.day}. Plan backwards from it, make at least one phase cover day ${context.anchor.day}, and finish no later than day ${Math.min(MAX_PLAN_DAYS, context.anchor.day + 7)}.`,
    );
  }
  if (context.revisionOf) {
    const r = context.revisionOf;
    out.push(
      [
        `This is a revision. The earlier plan was "${r.title}": ${r.summary}`,
        ...r.phases.map((p) => `- ${p}`),
        "Evidence marked NEW arrived after that plan was written. Keep what still holds, change what the new evidence contradicts, and put one sentence in revisionNote on what changed and why.",
      ].join("\n"),
    );
  }
  return out;
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
    ...renderSituation(context),
    renderEvidenceBlock(
      "Public market evidence (collected from public sources; cite by id)",
      context.patternEvidence,
    ),
    // The first-party block is rendered only when there is first-party
    // evidence, and always as its own labelled block — never merged.
    ...(context.baselineEvidence.length > 0
      ? [
          renderEvidenceBlock(
            "First-party baseline evidence (this client's own data; cite by id)",
            context.baselineEvidence,
          ),
        ]
      : []),
    context.patternEvidence.length + context.baselineEvidence.length > 0
      ? "A phase may cite evidence ids (evidenceIds) from ONE evidence list only — never mix the public list with the first-party list in one phase. Cite only ids shown above; leave evidenceIds empty when a phase rests on no evidence. Never present evidence as proof the plan will work."
      : "There is no collected evidence for this brief. Leave every evidenceIds empty and do not claim market evidence.",
    `Write a phased campaign plan with 3-6 phases on a day timeline (day 1 = launch prep, at most ${MAX_PLAN_DAYS} days in total). Each phase needs a name, startDay, endDay (endDay >= startDay), one channel, and a one-sentence message. Phases may overlap when channels run in parallel. Do not invent budgets, results or metrics.`,
    'Reply with JSON only: {"title":string,"summary":string,"phases":[{"name":string,"startDay":number,"endDay":number,"channel":string,"message":string,"evidenceIds":string[]}]' +
      (context.revisionOf ? ',"revisionNote":string' : "") +
      "}. The summary is one or two sentences.",
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
    parsed = planResponseSchema.parse(extractJson(raw));
  } catch (error) {
    throw new PlanError(
      `The planner returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const phases = [...parsed.phases]
    .sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay)
    .map(({ evidenceIds, ...phase }, index) => ({
      id: `p${index + 1}`,
      ...phase,
      ...(evidenceIds.length > 0 ? { evidenceIds } : {}),
    }));

  return {
    title: parsed.title,
    doc: {
      summary: parsed.summary,
      totalDays: Math.max(...phases.map((p) => p.endDay)),
      phases,
      coldStart: context.coldStart,
      evidenceStatus: context.evidenceStatus,
      ...(context.revisionOf && parsed.revisionNote
        ? { revisionNote: parsed.revisionNote }
        : {}),
      evidence: snapshotEvidence([
        ...context.patternEvidence,
        ...context.baselineEvidence,
      ]),
    },
  };
}

/** Cross-field invariants the schema cannot express. */
export function validatePlan(
  plan: GeneratedPlan,
  context?: PlanContext,
): ValidationResult {
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
  // A fixed date must actually be covered — otherwise the plan misses the event.
  const anchor = context?.anchor;
  if (
    anchor &&
    !plan.doc.phases.some(
      (p) => p.startDay <= anchor.day && anchor.day <= p.endDay,
    )
  ) {
    return {
      valid: false,
      reason: `No phase covers day ${anchor.day} (${anchor.label}); the plan would miss the date it exists for.`,
    };
  }
  // Citations are checked against what the planner was actually shown; an
  // invented id would otherwise render as evidence that does not exist.
  const problem = findCitationProblem(
    plan.doc.phases,
    context ? [...context.patternEvidence, ...context.baselineEvidence] : [],
  );
  if (problem) return { valid: false, reason: problem };
  return { valid: true };
}

const critiqueSchema = z.object({
  verdict: z.enum(["pass", "flagged"]),
  // A verbose reviewer must not void its whole review: keep the first five
  // substantive notes rather than rejecting the reply for being too long.
  feedback: z
    .array(z.string())
    .default([])
    .transform((notes) =>
      notes
        .map((n) => n.trim())
        .filter((n) => n.length >= 3)
        .slice(0, 5),
    ),
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
    'Reply with JSON only: {"verdict":"pass"|"flagged","feedback":string[]}. verdict is "flagged" only when feedback is non-empty. Give at most 5 short points. Do not invent problems in a sound plan.',
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
    return critiqueSchema.parse(extractJson(raw));
  } catch (error) {
    throw new PlanError(
      `The plan review returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
