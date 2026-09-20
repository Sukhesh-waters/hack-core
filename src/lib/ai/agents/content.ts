import { z } from "zod";
import type { BrandContext, BrandIdentity } from "@/db/schema";
import type { MergedBrandDna } from "@/lib/ai/brand-merge";
import { routeAI } from "@/lib/ai/router";

// ---------------------------------------------------------------------------
// Draft generation + refinement (W5): idea -> full brand-tuned content.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Multimodal asset pack: draft + brand -> storyboard, image prompts, VO.
// Deterministic template fill, not an LLM call — kept here because it
// operates directly on this file's Draft type and produces content assets.
// ---------------------------------------------------------------------------

export type StoryboardScene = {
  sceneNumber: number;
  timecode: string;
  visualDescription: string;
  onScreenText: string;
  audioGuidance: string;
};

export type ImagePromptAsset = {
  title: string;
  aspectRatio: "1:1" | "9:16" | "16:9" | "4:5";
  prompt: string;
  negativePrompt?: string;
};

export type VoiceoverLine = {
  timestamp: string;
  speaker: string;
  line: string;
  direction: string;
};

export type MultimodalAssetPack = {
  storyboard: StoryboardScene[];
  imagePrompts: ImagePromptAsset[];
  voiceover: VoiceoverLine[];
};

/**
 * Generates visual storyboard frames, image generation prompts, and audio voiceover scripts
 * tailored to the draft and brand identity.
 */
export function generateMultimodalAssets(input: {
  draft: Draft;
  brand: MergedBrandDna;
}): MultimodalAssetPack {
  const { draft, brand } = input;
  const brandColorsStr = brand.colors.length > 0 ? brand.colors.join(", ") : "emerald, indigo";
  const voiceStr = brand.tone || brand.voice || "authoritative, concise";
  const themeStr = brand.showcaseTheme || "modern minimalist";

  // 1. Storyboard Generation
  const storyboard: StoryboardScene[] = [
    {
      sceneNumber: 1,
      timecode: "00:00 - 00:03",
      visualDescription: `High-impact opening shot matching ${themeStr} aesthetic. Dynamic camera push-in establishing the core concept.`,
      onScreenText: draft.caption.slice(0, 45) + (draft.caption.length > 45 ? "…" : ""),
      audioGuidance: `Energetic and ${voiceStr} tone with subtle background riser.`,
    },
    {
      sceneNumber: 2,
      timecode: "00:03 - 00:15",
      visualDescription: `Clean product/service demonstration highlighting key benefit. Color accents in ${brandColorsStr}. Clean typography overlays.`,
      onScreenText: "Why it matters for your team",
      audioGuidance: `Steady narration pacing: "${draft.script.slice(0, 60)}…"`,
    },
    {
      sceneNumber: 3,
      timecode: "00:15 - 00:25",
      visualDescription: `Social proof or visual evidence shot. Split-screen UI or high-contrast lifestyle visual.`,
      onScreenText: "Proven results in real-time",
      audioGuidance: "Authoritative and confident delivery.",
    },
    {
      sceneNumber: 4,
      timecode: "00:25 - 00:30",
      visualDescription: `Final outro screen featuring brand logo, clear call-to-action button, and minimal background blur.`,
      onScreenText: draft.cta,
      audioGuidance: `Clear resolution tone: "${draft.cta}"`,
    },
  ];

  // 2. Image Prompts Generation (Midjourney v6 & DALL-E 3 optimized)
  const imagePrompts: ImagePromptAsset[] = [
    {
      title: "Hero Feed Cover (Square 1:1)",
      aspectRatio: "1:1",
      prompt: `Editorial photographic shot of modern workspace with subtle ${brandColorsStr} ambient lighting, minimalist design, hyper-detailed, studio lighting, Shot on Hasselblad H6D-100c --ar 1:1 --v 6.0 --style raw`,
      negativePrompt: "blurry, low quality, oversaturated, watermark, text",
    },
    {
      title: "Story / Reel Visual (Vertical 9:16)",
      aspectRatio: "9:16",
      prompt: `Cinematic vertical video keyframe showcasing innovative technology workflow, subtle glassmorphic UI overlay, glowing ${brand.colors[0] ?? "teal"} neon accents, soft bokeh --ar 9:16 --v 6.0`,
      negativePrompt: "grainy, distorted, extra limbs, bad anatomy",
    },
    {
      title: "Meta Ad Banner (Landscape 16:9)",
      aspectRatio: "16:9",
      prompt: `Premium commercial product photography for digital marketing campaign, clean negative space on left for copy, modern gradient backdrop in ${brandColorsStr} --ar 16:9 --v 6.0`,
      negativePrompt: "cluttered, noisy, dark shadows",
    },
  ];

  // 3. Voiceover & Audio Script
  const voiceover: VoiceoverLine[] = [
    {
      timestamp: "00:00",
      speaker: "Narrator (AI Voice)",
      line: draft.caption.split("\n")[0] ?? "Transform your workflow today.",
      direction: `Hook delivery, ${voiceStr}, high energy.`,
    },
    {
      timestamp: "00:05",
      speaker: "Narrator (AI Voice)",
      line: draft.script.slice(0, 120),
      direction: "Informative and natural pacing with smooth transitions.",
    },
    {
      timestamp: "00:25",
      speaker: "Narrator (AI Voice)",
      line: draft.cta,
      direction: "Decisive call to action with rising intonation.",
    },
  ];

  return { storyboard, imagePrompts, voiceover };
}

// ---------------------------------------------------------------------------
// Brand DNA research (W4): first-party evidence (+ optional declared vault)
// -> derived brand identity. Runs once per client; caching is enforced by
// the unique brand_profiles index + the action layer, not here.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Ask InstaMedia — the floating workspace assistant. Grounding is
// first-party/operational data ONLY (clients, schedule, tasks, approvals,
// ideas). Pattern-layer rows never enter this context, so answers can never
// cite public data as brand evidence (two-layer rule).
// ---------------------------------------------------------------------------

export type AskGrounding = {
  workspaceName: string;
  role: "owner" | "admin" | "member";
  clients: { name: string; status: string }[];
  upcomingSlots: {
    title: string;
    clientName: string;
    status: string;
    scheduledFor: Date;
  }[];
  openTasks: { text: string; priority: string }[];
  pendingApprovals: { title: string }[];
  newIdeas: { topic: string; hook: string }[];
};

/** Keep grounding token-bounded — the assistant answers about "now",
 *  not the archive. */
export const ASK_MAX_ITEMS = 10;

export function buildAskSystem(role: AskGrounding["role"]): string {
  return [
    "You are Ask InstaMedia, the in-app assistant for one agency workspace.",
    `The user's role in this workspace is "${role}".`,
    "Answer ONLY from the workspace context provided. If the context doesn't cover the question, say you don't see it in this workspace — never invent clients, posts, metrics, or dates.",
    "Never reference other workspaces or public/scraped pattern data.",
    "Be concise: a short direct answer, then at most a few supporting lines.",
  ].join(" ");
}

function section(title: string, lines: string[]): string {
  return `${title}:\n${lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : "- (none)"}`;
}

export function buildAskPrompt(
  grounding: AskGrounding,
  question: string,
): string {
  const cap = <T>(rows: T[]) => rows.slice(0, ASK_MAX_ITEMS);
  return [
    `Workspace: ${grounding.workspaceName}`,
    section(
      "Clients",
      cap(grounding.clients).map((c) => `${c.name} (${c.status})`),
    ),
    section(
      "Upcoming schedule",
      cap(grounding.upcomingSlots).map(
        (s) =>
          `${s.scheduledFor.toISOString().slice(0, 10)} · ${s.clientName} · ${s.title} [${s.status}]`,
      ),
    ),
    section(
      "Open team tasks",
      cap(grounding.openTasks).map((t) => `[${t.priority}] ${t.text}`),
    ),
    section(
      "Pending approvals",
      cap(grounding.pendingApprovals).map((a) => a.title),
    ),
    section(
      "Fresh ideas awaiting review",
      cap(grounding.newIdeas).map((i) => `${i.topic} — ${i.hook}`),
    ),
    `Question: ${question}`,
  ].join("\n\n");
}

export async function askInstamedia(
  grounding: AskGrounding,
  question: string,
): Promise<string> {
  return routeAI({
    kind: "chat",
    system: buildAskSystem(grounding.role),
    prompt: buildAskPrompt(grounding, question),
  });
}
