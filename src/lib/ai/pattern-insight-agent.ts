import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

export class PatternInsightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternInsightError";
  }
}

/**
 * The ONLY input shape this agent accepts: public pattern rows. Typing the
 * input to pattern-post fields (pageHandle/segment — no reach, no scores,
 * no baseline ids) is the structural half of the two-layer guarantee; the
 * unit test in pattern-insight-agent.test.ts is the behavioural half.
 */
export type PatternPostInput = {
  id: string;
  pageHandle: string;
  segment: string | null;
  caption: string | null;
  format: string | null;
  likes: number | null;
  comments: number | null;
};

export type PatternObservation = {
  pattern: string;
  evidence: string[]; // pattern post ids ONLY — never baseline citations
  suggestion: string;
};

const responseSchema = z.object({
  observations: z
    .array(
      z.object({
        pattern: z.string().min(3),
        evidence: z.array(z.string()).default([]),
        suggestion: z.string().min(3),
      }),
    )
    .min(1)
    .max(6),
});

/** Evidence ids must reference the provided pattern rows — anything else
 * (hallucinated, baseline post ids) is stripped. */
export function validateEvidence(
  observations: PatternObservation[],
  allowedPatternIds: string[],
): PatternObservation[] {
  const allowed = new Set(allowedPatternIds);
  return observations.map((obs) => ({
    ...obs,
    evidence: obs.evidence.filter((id) => allowed.has(id)),
  }));
}

export function buildInsightPrompt(posts: PatternPostInput[]): string {
  return [
    "Public pattern posts (inspiration only — market context, NOT this brand's performance data):",
    posts
      .map(
        (p) =>
          `- [${p.id}] @${p.pageHandle}${p.segment ? ` (${p.segment})` : ""} · ${p.format ?? "post"} · ${p.likes ?? 0} likes / ${p.comments ?? 0} comments: ${(p.caption ?? "").slice(0, 160)}`,
      )
      .join("\n"),
    'Extract 2-5 format/hook/structure observations useful as inspiration. Reply with JSON only: {"observations":[{"pattern":string,"evidence":string[],"suggestion":string}]}. evidence must use ONLY the bracketed ids above. Frame every suggestion as inspiration to adapt — never as proof of what works for this brand.',
  ].join("\n\n");
}

/**
 * Pattern insight agent (Slice E2): reads top public pattern posts of a run,
 * returns inspiration-only observations. Two-layer rule: input type accepts
 * pattern rows only; evidence validated against them post-hoc.
 */
export async function generatePatternInsights(
  posts: PatternPostInput[],
): Promise<PatternObservation[]> {
  if (posts.length === 0) return [];
  const raw = await routeAI({
    kind: "chat",
    tier: "quality",
    json: true,
    system:
      "You are a social format analyst. You study public posts for structural patterns. You never present public engagement as evidence of what performs for the user's own brand.",
    prompt: buildInsightPrompt(posts),
  });

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new PatternInsightError(
      `Pattern insight returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
  return validateEvidence(
    parsed.observations,
    posts.map((p) => p.id),
  );
}
