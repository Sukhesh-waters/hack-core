import { z } from "zod";
import type { BrandIdentity } from "@/db/schema";
import type { MergedBrandDna } from "@/lib/ai/brand-merge";
import { routeAI } from "@/lib/ai/router";

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export type Draft = {
  caption: string;
  script: string;
  hashtags: string[];
  cta: string;
};

/** Normalize a free-text or array hashtag input to `#`-prefixed tags,
 * dropping blanks. Shared by the AI draft schema and the manual
 * start-draft form so both produce the same body shape. */
export function normalizeHashtags(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/\s+/);
  return raw
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
}

const draftSchema = z.object({
  caption: z.string().min(3),
  script: z.string().min(3),
  hashtags: z.array(z.string()).max(30).transform(normalizeHashtags),
  cta: z.string().min(2),
});

const SECTION_ORDER = ["Caption", "Script", "Hashtags", "CTA"] as const;

/** content.body storage format — human-readable markdown, machine-parseable. */
export function formatDraftBody(draft: Draft): string {
  return [
    `## Caption\n${draft.caption}`,
    `## Script\n${draft.script}`,
    `## Hashtags\n${draft.hashtags.join(" ")}`,
    `## CTA\n${draft.cta}`,
  ].join("\n\n");
}

export function parseDraftBody(body: string): Draft | null {
  const sections: Record<string, string> = {};
  const parts = body.split(/^## /m).filter(Boolean);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    sections[part.slice(0, newline).trim()] = part.slice(newline + 1).trim();
  }
  if (!SECTION_ORDER.every((name) => name in sections)) return null;
  return {
    caption: sections.Caption,
    script: sections.Script,
    hashtags: sections.Hashtags.split(/\s+/).filter(Boolean),
    cta: sections.CTA,
  };
}

/** BrandIdentity or the merged DNA — declared vault fields are optional extras. */
export type BrandDna = BrandIdentity & Partial<MergedBrandDna>;

function brandRules(identity: BrandDna): string {
  const lines = [
    `Brand rules — voice: ${identity.voice}. Tone: ${identity.tone}. Audience: ${identity.audience}. Pillars: ${identity.pillars.join(", ")}. Never: ${identity.doNots.join("; ") || "(none)"}.`,
  ];
  if (identity.brandType) {
    lines.push(`Positioning: ${identity.brandType.replace(/_/g, " ")}.`);
  }
  if (identity.showcaseTheme) {
    lines.push(`Showcase theme: ${identity.showcaseTheme}.`);
  }
  if (identity.colors?.length) {
    lines.push(`Brand palette (reference in visual directions): ${identity.colors.join(", ")}.`);
  }
  if (identity.typography) {
    lines.push(`Typography: ${identity.typography}.`);
  }
  if (identity.bannedWords?.length) {
    lines.push(
      `Hard-banned words — these must never appear in any field: ${identity.bannedWords.join(", ")}.`,
    );
  }
  return lines.join(" ");
}

const RESPONSE_SHAPE =
  'Reply with JSON only: {"caption":string,"script":string,"hashtags":string[],"cta":string}.';

async function runDraftCall(system: string, prompt: string): Promise<Draft> {
  const raw = await routeAI({
    kind: "chat",
    tier: "quality",
    json: true,
    system,
    prompt,
  });
  try {
    return draftSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new GenerationError(
      `Generation returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/** Generation agent (W5): idea → full brand-tuned content. */
export async function generateDraft(input: {
  idea: { hook: string; angle: string | null; format: string | null };
  identity: BrandDna;
}): Promise<Draft> {
  return runDraftCall(
    "You are a senior social copywriter. Every word must fit the brand rules.",
    [
      brandRules(input.identity),
      `Idea — hook: ${input.idea.hook}. Angle: ${input.idea.angle ?? "-"}. Format: ${input.idea.format ?? "post"}.`,
      `Write the full content: caption (ready to publish), a shot-by-shot script for the format, hashtags, and a CTA. ${RESPONSE_SHAPE}`,
    ].join("\n\n"),
  );
}

/** Refinement (W5): one call, user-triggered — no agent spawns an agent. */
export async function refineDraft(input: {
  draft: Draft;
  feedback: string;
  identity: BrandDna;
}): Promise<Draft> {
  return runDraftCall(
    "You are a senior social copywriter revising a draft. Apply the feedback while keeping the brand rules.",
    [
      brandRules(input.identity),
      `Current draft:\n${formatDraftBody(input.draft)}`,
      `Feedback to apply: ${input.feedback}`,
      RESPONSE_SHAPE,
    ].join("\n\n"),
  );
}
