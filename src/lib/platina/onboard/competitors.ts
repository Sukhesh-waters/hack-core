/**
 * Competitor proposals (core spine S2). A draft only: the model suggests, the
 * operator prunes, and nothing is fetched until they approve. A malformed or
 * failed reply raises a typed error so the screen says "we couldn't suggest
 * competitors — add them yourself" instead of showing a silent empty list.
 */
import { extractJson } from "../json";
import { z } from "zod";
import { routeAI } from "@/lib/ai/router";
import { normalizeHomepage } from "./derive";

export const MAX_COMPETITOR_PROPOSALS = 8;

export class CompetitorProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompetitorProposalError";
  }
}

export type CompetitorProposal = {
  name: string;
  homepageUrl: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

const replySchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(80),
        homepageUrl: z.string().trim().min(3).max(200),
        reason: z.string().trim().min(3).max(200),
        confidence: z.enum(["high", "medium", "low"]).default("medium"),
      }),
    )
    .max(20),
});

export function buildCompetitorPrompt(brand: {
  name: string;
  homepageUrl: string | null;
  region: string | null;
}): string {
  return [
    `Client: ${brand.name}`,
    brand.homepageUrl ? `Website: ${brand.homepageUrl}` : "Website: not given.",
    brand.region ? `Region: ${brand.region}` : "Region: not given.",
    `Name up to ${MAX_COMPETITOR_PROPOSALS} direct competitors this client's marketing team should watch. Only include companies you are confident exist, with their real main website. Do not invent domains; if unsure, leave the company out.`,
    'Reply with JSON only: {"competitors":[{"name":string,"homepageUrl":string,"reason":string,"confidence":"high"|"medium"|"low"}]}.',
  ].join("\n");
}

/** Pure: validates a raw reply into proposals (usable https origins, deduped, capped). */
export function parseCompetitorReply(raw: string): CompetitorProposal[] {
  let parsed: z.infer<typeof replySchema>;
  try {
    parsed = replySchema.parse(extractJson(raw));
  } catch (error) {
    throw new CompetitorProposalError(
      `unusable competitor reply: ${error instanceof Error ? error.message.slice(0, 100) : "unknown"}`,
    );
  }
  const seen = new Set<string>();
  const out: CompetitorProposal[] = [];
  for (const c of parsed.competitors) {
    const origin = normalizeHomepage(c.homepageUrl);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    out.push({ ...c, homepageUrl: origin });
  }
  return out.slice(0, MAX_COMPETITOR_PROPOSALS);
}

export async function proposeCompetitors(brand: {
  name: string;
  homepageUrl: string | null;
  region: string | null;
}): Promise<CompetitorProposal[]> {
  let raw: string;
  try {
    raw = await routeAI({
      kind: "chat",
      tier: "fast",
      json: true,
      system:
        "You suggest real competitors for a marketing team. Never invent companies or websites.",
      prompt: buildCompetitorPrompt(brand),
    });
  } catch (error) {
    throw new CompetitorProposalError(
      `competitor suggestion unavailable: ${error instanceof Error ? error.message.slice(0, 100) : "unknown"}`,
    );
  }
  return parseCompetitorReply(raw);
}
