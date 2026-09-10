import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

export type CounterStrategyInput = {
  competitorHook: string;
  brandContext: string;
  targetAudience?: string;
};

const counterIdeaSchema = z.object({
  topic: z.string().min(3),
  hook: z.string().min(5),
  angle: z.string().min(5),
  targetPainPoint: z.string().min(3),
  sourceCompetitorHook: z.string(),
});

const counterResponseSchema = z.object({
  counterAngles: z.array(counterIdeaSchema).min(1).max(5),
});

export type CounterIdea = z.infer<typeof counterIdeaSchema>;

export function buildCounterStrategyPrompt(input: CounterStrategyInput): string {
  return [
    `Competitor Hook: "${input.competitorHook}"`,
    `Brand Context: "${input.brandContext}"`,
    input.targetAudience ? `Target Audience: "${input.targetAudience}"` : "",
    "",
    "Generate 3 strategic counter-positioning content angles for our brand.",
    "Rule: Each angle must address the same audience pain point but flip the narrative in favor of our brand's unique positioning.",
    'Reply with JSON only matching schema: {"counterAngles":[{"topic":string, "hook":string, "angle":string, "targetPainPoint":string, "sourceCompetitorHook":string}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Counter-Strategy Agent.
 * Reads public competitor hooks/ads and generates counter-positioning content angles
 * for the brand's ideation pool.
 *
 * Isolation Guarantee: Pure function over pattern inputs. Never mutates first-party
 * baseline performance or touches metrics tables.
 */
export async function generateCounterStrategy(
  input: CounterStrategyInput,
): Promise<CounterIdea[]> {
  if (!input.competitorHook.trim() || !input.brandContext.trim()) {
    return [];
  }

  const raw = await routeAI({
    kind: "chat",
    tier: "fast", // Leverages free Groq Llama 3.3 70B tier
    json: true,
    system:
      "You are a competitive positioning strategist. You create sharp, differentiated counter-angles for brands based on competitor marketing hooks without making false claims.",
    prompt: buildCounterStrategyPrompt(input),
  });

  const parsed = counterResponseSchema.parse(JSON.parse(raw));
  return parsed.counterAngles;
}
