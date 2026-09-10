import { z } from "zod";
import type { BrandIdentity } from "@/db/schema";
import { routeAI } from "@/lib/ai/router";
import type { DriverPost } from "@/lib/ai/retrieval";

export class IdeationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdeationError";
  }
}

export type IdeaDraft = {
  hook: string;
  angle: string;
  format: string;
  why: { reason: string; citations: string[] };
};

const responseSchema = z.object({
  ideas: z
    .array(
      z.object({
        hook: z.string().min(3),
        angle: z.string().min(3),
        format: z.string().min(2),
        why: z.object({
          reason: z.string().min(3),
          citations: z.array(z.string()).default([]),
        }),
      }),
    )
    .min(1)
    .max(8),
});

/**
 * Constitution guardrail: "why this idea" may cite first-party baseline rows
 * ONLY. Anything else — hallucinated ids, pattern rows — is stripped. The
 * reason survives; the citation does not.
 */
export function validateCitations(
  ideas: IdeaDraft[],
  allowedPostIds: string[],
): IdeaDraft[] {
  const allowed = new Set(allowedPostIds);
  return ideas.map((idea) => ({
    ...idea,
    why: {
      reason: idea.why.reason,
      citations: idea.why.citations.filter((id) => allowed.has(id)),
    },
  }));
}

export const DECLARED_ONLY_REASON = "Declared brand context (no baseline yet)";

/**
 * Empty-baseline mode: ideas ran on declared Brand DNA alone. The "why" says
 * so honestly and citations stay empty — never invent post citations
 * (min-N gate, constitution).
 */
export function markDeclaredOnly(ideas: IdeaDraft[]): IdeaDraft[] {
  return ideas.map((idea) => ({
    ...idea,
    why: { reason: DECLARED_ONLY_REASON, citations: [] },
  }));
}

export function buildIdeationPrompt(input: {
  topic: string;
  identity: BrandIdentity;
  brief: string;
  drivers: DriverPost[];
  /** G1 — optional. When absent the prompt is byte-identical to pre-G1. */
  goal?: { title: string; hypothesis: string | null } | null;
}): string {
  const goalLine = input.goal
    ? [
        `Client goal: ${input.goal.title}.${
          input.goal.hypothesis
            ? ` Hypothesis under test: ${input.goal.hypothesis}.`
            : ""
        }`,
      ]
    : [];
  return [
    ...goalLine,
    `Topic: ${input.topic}`,
    `Brand DNA — voice: ${input.identity.voice}. Tone: ${input.identity.tone}. Audience: ${input.identity.audience}. Pillars: ${input.identity.pillars.join(", ")}. Never: ${input.identity.doNots.join("; ") || "(none)"}.`,
    `Driver brief (first-party evidence):\n${input.brief}`,
    `Citable driver ids (use ONLY these in citations): ${input.drivers.map((d) => d.id).join(", ") || "(none)"}`,
    'Generate 4-6 content ideas. Reply with JSON only: {"ideas":[{"hook":string,"angle":string,"format":string,"why":{"reason":string,"citations":string[]}}]}. Each "why" must be grounded in the driver brief; citations must come from the citable ids list.',
  ].join("\n\n");
}

/** Ideation agent (W5): quality tier, citations validated post-hoc. */
export async function generateIdeas(input: {
  topic: string;
  identity: BrandIdentity;
  brief: string;
  drivers: DriverPost[];
  /** The driver ids the brief actually cited. When provided, idea citations
   *  are validated against this subset — so a "why" can only cite evidence
   *  that was truly part of the analytical brief, not any pooled driver.
   *  Empty/omitted falls back to the full driver pool (e.g. declared-only). */
  citedPostIds?: string[];
  /** G1 — optional. Passed straight through to buildIdeationPrompt. */
  goal?: { title: string; hypothesis: string | null } | null;
}): Promise<IdeaDraft[]> {
  const raw = await routeAI({
    kind: "chat",
    tier: "quality",
    json: true,
    system:
      "You are a senior social content strategist. Ideas must be on-brand and grounded in the provided first-party evidence.",
    prompt: buildIdeationPrompt(input),
  });

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new IdeationError(
      `Ideation returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const allowed =
    input.citedPostIds && input.citedPostIds.length > 0
      ? input.citedPostIds
      : input.drivers.map((d) => d.id);
  return validateCitations(parsed.ideas, allowed);
}

const combineSchema = z.object({
  topic: z.string().min(3),
  hook: z.string().min(3),
  angle: z.string().min(3),
  format: z.string().min(2),
  reason: z.string().min(3),
});

export async function combineIdeas(input: {
  ideas: { topic: string; hook: string; angle?: string | null; format?: string | null }[];
  identity: BrandIdentity;
}): Promise<IdeaDraft> {
  if (input.ideas.length < 2) {
    throw new IdeationError("Select at least 2 ideas to combine.");
  }
  const summary = input.ideas
    .map((i, idx) => `${idx + 1}. Topic: ${i.topic} | Hook: ${i.hook}`)
    .join("\n");

  const prompt = `You are a strategic creative director combining multiple content concepts into one unified, high-performing concept.
Brand DNA — Voice: ${input.identity.voice}, Tone: ${input.identity.tone}.
Concepts to merge:
${summary}

Reply with JSON only: {"topic":string,"hook":string,"angle":string,"format":string,"reason":string}`;

  const res = await routeAI({
    kind: "chat",
    tier: "quality",
    json: true,
    system: "You are a senior social content strategist.",
    prompt: prompt,
  });

  const parsed = combineSchema.safeParse(JSON.parse(res));
  if (!parsed.success) {
    throw new IdeationError("Combined output schema failed validation.");
  }

  return {
    hook: parsed.data.hook,
    angle: parsed.data.angle,
    format: parsed.data.format,
    why: {
      reason: parsed.data.reason,
      citations: [],
    },
  };
}
