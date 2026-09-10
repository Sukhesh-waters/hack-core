import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

export const POST_FORMATS = [
  "reel",
  "carousel",
  "image",
  "video",
  "story",
  "text",
] as const;

export type NormalizedMeta = { format: string | null; topics: string[] };

const responseSchema = z.object({
  posts: z.array(
    z.object({
      index: z.number().int(),
      format: z.enum(POST_FORMATS).nullable(),
      topics: z.array(z.string()).max(5).default([]),
    }),
  ),
});

const SYSTEM_PROMPT = [
  "You classify social media captions.",
  'Reply with JSON only, shaped {"posts":[{"index":number,"format":"reel"|"carousel"|"image"|"video"|"story"|"text"|null,"topics":string[]}]}.',
  "topics are 1-3 word themes, at most 5 per post. Keep every input index.",
].join(" ");

/**
 * Classify captions into format + topics via the router (Groq fast tier).
 * Normalization is an enhancement, not a gate: any failure returns nulls and
 * the import proceeds unnormalized (degradation ladder).
 */
export async function normalizeCaptions(
  captions: (string | undefined)[],
): Promise<(NormalizedMeta | null)[]> {
  const indexed = captions
    .map((caption, index) => ({ index, caption: caption?.trim() ?? "" }))
    .filter((entry) => entry.caption !== "");
  if (indexed.length === 0) return captions.map(() => null);

  try {
    const raw = await routeAI({
      kind: "chat",
      json: true,
      system: SYSTEM_PROMPT,
      prompt: JSON.stringify({ posts: indexed }),
    });
    const parsed = responseSchema.parse(JSON.parse(raw));
    const byIndex = new Map(parsed.posts.map((post) => [post.index, post]));
    return captions.map((_, i) => {
      const hit = byIndex.get(i);
      return hit ? { format: hit.format, topics: hit.topics } : null;
    });
  } catch {
    return captions.map(() => null);
  }
}
