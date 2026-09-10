import { z } from "zod";
import type { BrandContext, BrandIdentity } from "@/db/schema";
import { routeAI } from "@/lib/ai/router";

export class BrandResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandResearchError";
  }
}

export type BrandResearchInput = {
  name: string;
  handle: string | null;
  kbStats: {
    total: number;
    baselineSize: number;
    medianEngagement: number | null;
  };
  topCaptions: string[];
  /** Human-declared context. When present the agent enriches — never invents. */
  declared?: BrandContext | null;
};

function declaredBlock(declared: BrandContext): string {
  return [
    "Human-declared brand context (authoritative — do not contradict it, enrich it):",
    `- Brand type: ${declared.brandType.replace(/_/g, " ")}`,
    `- Mission: ${declared.mission}`,
    `- Showcase theme: ${declared.showcaseTheme}`,
    `- Tones: ${declared.tones.join(", ") || "(none)"}`,
    `- Pillars: ${declared.pillars.join(", ") || "(none)"}`,
    `- Never say: ${declared.bannedWords.join(", ") || "(none)"}`,
    `- Avoid topics: ${declared.avoidTopics.join(", ") || "(none)"}`,
  ].join("\n");
}

const identitySchema = z.object({
  voice: z.string().min(3),
  tone: z.string().min(3),
  audience: z.string().min(3),
  pillars: z.array(z.string()).min(3).max(6),
  doNots: z.array(z.string()).max(6).default([]),
  formats: z.array(z.string()).max(5).default([]),
});

/** Pure prompt assembly for the one-time Brand DNA research. */
export function buildBrandPrompt(input: BrandResearchInput): string {
  const task = input.declared
    ? 'Enrich the declared context with this evidence: fill voice/audience nuance, validate the pillars against what actually performs. Never contradict a declared rule. Reply with JSON only: {"voice":string,"tone":string,"audience":string,"pillars":string[3-6],"doNots":string[max 6],"formats":string[max 5]}. Be specific to this brand — no generic filler.'
    : 'Derive the brand\'s DNA from this evidence. Reply with JSON only: {"voice":string,"tone":string,"audience":string,"pillars":string[3-6],"doNots":string[max 6],"formats":string[max 5]}. Be specific to this brand — no generic filler.';
  return [
    `Brand: ${input.name}${input.handle ? ` (${input.handle})` : ""}`,
    ...(input.declared ? [declaredBlock(input.declared)] : []),
    `Knowledge base: ${input.kbStats.total} posts ingested, ${input.kbStats.baselineSize} in the first-party baseline, median engagement ${input.kbStats.medianEngagement ?? "unknown"}.`,
    "Top-performing captions (first-party):",
    input.topCaptions.map((c) => `- ${c.slice(0, 140)}`).join("\n") ||
      "- (none yet)",
    task,
  ].join("\n\n");
}

/**
 * Brand DNA onboarding agent (W4). Quality tier, runs once per client —
 * caching is enforced by the unique brand_profiles index + the action layer.
 */
export async function researchBrand(
  input: BrandResearchInput,
): Promise<BrandIdentity> {
  const raw = await routeAI({
    kind: "chat",
    tier: "quality",
    json: true,
    system:
      "You are a brand strategist. Ground every conclusion in the provided first-party evidence.",
    prompt: buildBrandPrompt(input),
  });

  try {
    return identitySchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new BrandResearchError(
      `Brand research returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
