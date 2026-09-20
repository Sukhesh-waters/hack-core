import { z } from "zod";
import type { BrandIdentity } from "@/db/schema";
import type { SopRunRow, SopRunStepRow } from "@/db/queries/sop";
import { routeAI } from "@/lib/ai/router";
import type { DriverPost } from "@/lib/ai/retrieval";
import { wouldCreateCycle } from "@/lib/sop/dependencies";
import {
  MAX_OFFSET_DAYS,
  SOP_STEP_CREATES,
  SOP_STEP_GATES,
} from "@/lib/sop/template";

// ---------------------------------------------------------------------------
// Ideation (W5): topic + brand DNA + first-party drivers -> content ideas.
// ---------------------------------------------------------------------------

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

const ideaResponseSchema = z.object({
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

  let parsed: z.infer<typeof ideaResponseSchema>;
  try {
    parsed = ideaResponseSchema.parse(JSON.parse(raw));
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

// ---------------------------------------------------------------------------
// Campaign strategy + post-mortem: market intelligence -> launch strategy,
// and (spend/impressions/clicks) -> honest performance review.
// ---------------------------------------------------------------------------

export type CampaignContext = {
  name: string;
  objective: string;
  budget: number;
  audience: { demographics?: string; interests?: string[]; locations?: string[] };
  creativeSummary: string;
  /** Performance metrics (0 = no data yet). */
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type MarketIntelligence = {
  competitorHooks: string[];
  trendingFormats: string[];
  audienceInsights: string[];
};

export type BrandContext = {
  brandName: string;
  positioning: string;
  pillar?: string;
};

const strategySchema = z.object({
  recommendedObjective: z.enum([
    "awareness",
    "traffic",
    "engagement",
    "leads",
    "conversions",
  ]),
  recommendedBudgetRange: z.object({
    min: z.number().min(0),
    max: z.number().min(0),
  }),
  audienceSuggestion: z.string().min(5),
  adCopyVariants: z.array(z.string().min(5)).min(1).max(3),
  strategySummary: z.string().min(10),
  keyRisks: z.array(z.string()),
});

export type CampaignStrategy = z.infer<typeof strategySchema>;

export function buildStrategyPrompt(
  brand: BrandContext,
  market: MarketIntelligence,
  selectedContent?: { title: string; body: string | null },
): string {
  return [
    `Brand: "${brand.brandName}" — Positioning: "${brand.positioning}"`,
    selectedContent
      ? `Selected Content: "${selectedContent.title}" — ${selectedContent.body?.slice(0, 200) ?? "(no body)"}`
      : "",
    "",
    "MARKET INTELLIGENCE:",
    `• Competitor hooks: ${market.competitorHooks.slice(0, 5).join("; ") || "none observed"}`,
    `• Trending formats: ${market.trendingFormats.slice(0, 5).join("; ") || "unknown"}`,
    `• Audience insights: ${market.audienceInsights.slice(0, 3).join("; ") || "general"}`,
    "",
    "Generate a campaign launch strategy including:",
    "1. Recommended objective (awareness/traffic/engagement/leads/conversions)",
    "2. Budget range (min/max in dollars)",
    "3. Audience targeting suggestion",
    "4. 1-3 ad copy variants",
    "5. Strategy summary",
    "6. Key risks to watch",
    "",
    'Reply with JSON only matching schema: {"recommendedObjective":string, "recommendedBudgetRange":{"min":number,"max":number}, "audienceSuggestion":string, "adCopyVariants":string[], "strategySummary":string, "keyRisks":string[]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Pre-launch mode: generates a complete campaign strategy from market
 * intelligence + brand context + optional selected content.
 */
export async function generateCampaignStrategy(
  brand: BrandContext,
  market: MarketIntelligence,
  selectedContent?: { title: string; body: string | null },
): Promise<CampaignStrategy> {
  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are a paid media strategist. Create data-informed campaign strategies based on competitive intelligence and brand positioning. Be specific with audience targeting and budget recommendations. Never fabricate performance predictions.",
    prompt: buildStrategyPrompt(brand, market, selectedContent),
  });

  return strategySchema.parse(JSON.parse(raw));
}

const postMortemSchema = z.object({
  whatWorked: z.array(z.string().min(5)),
  whatFailed: z.array(z.string().min(5)),
  levelUpActions: z.array(z.string().min(5)),
  nextIterationBrief: z.string().min(10),
});

export type CampaignPostMortem = z.infer<typeof postMortemSchema>;

export function buildPostMortemPrompt(
  campaign: CampaignContext,
  market: MarketIntelligence,
): string {
  const hasPerformance = campaign.spend > 0 || campaign.impressions > 0;

  const perfBlock = hasPerformance
    ? [
        "PERFORMANCE DATA:",
        `• Spend: $${campaign.spend.toFixed(2)}`,
        `• Impressions: ${campaign.impressions.toLocaleString()}`,
        `• Clicks: ${campaign.clicks.toLocaleString()} (CTR: ${campaign.impressions > 0 ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2) : "0"}%)`,
        `• Conversions: ${campaign.conversions}`,
        `• CPC: $${campaign.clicks > 0 ? (campaign.spend / campaign.clicks).toFixed(2) : "N/A"}`,
        `• CPM: $${campaign.impressions > 0 ? ((campaign.spend / campaign.impressions) * 1000).toFixed(2) : "N/A"}`,
      ]
    : [
        "PERFORMANCE DATA: Not yet available (pre-launch or no tracking connected).",
        "Analyze based on strategy strength and market alignment only.",
      ];

  return [
    `Campaign: "${campaign.name}"`,
    `Objective: ${campaign.objective}`,
    `Budget: $${campaign.budget}`,
    `Creative: ${campaign.creativeSummary}`,
    `Audience: ${campaign.audience.demographics ?? "general"}; interests: ${(campaign.audience.interests ?? []).join(", ") || "none"}`,
    "",
    ...perfBlock,
    "",
    "CURRENT MARKET TRENDS:",
    `• Competitor hooks: ${market.competitorHooks.slice(0, 5).join("; ") || "none observed"}`,
    `• Trending formats: ${market.trendingFormats.slice(0, 5).join("; ") || "unknown"}`,
    "",
    "Provide honest post-mortem analysis:",
    "1. What worked (specific elements)",
    "2. What failed or underperformed (specific elements)",
    "3. Level-up actions for the next iteration",
    "4. A brief for the next campaign iteration",
    "",
    'Reply with JSON only matching schema: {"whatWorked":string[], "whatFailed":string[], "levelUpActions":string[], "nextIterationBrief":string}',
  ].join("\n");
}

/**
 * Post-mortem mode: analyzes campaign performance (or strategy if no
 * performance data yet) and generates improvement recommendations.
 *
 * Graceful degradation: when spend/impressions/clicks are 0, the agent
 * operates in "strategy review" mode — evaluating the campaign brief
 * against market intelligence without fabricating performance predictions.
 */
export async function analyzeCampaignPerformance(
  campaign: CampaignContext,
  market: MarketIntelligence,
): Promise<CampaignPostMortem> {
  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are a performance marketing analyst reviewing campaign results. Be brutally honest about what worked and what didn't. When performance data is unavailable, analyze the strategy and creative against market intelligence. Never fabricate metrics.",
    prompt: buildPostMortemPrompt(campaign, market),
  });

  return postMortemSchema.parse(JSON.parse(raw));
}

// ---------------------------------------------------------------------------
// Counter-strategy: public competitor hooks -> counter-positioning angles.
// Isolation guarantee: pure function over pattern inputs, never touches
// first-party baseline performance or metrics tables.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SOP next-action suggestion: blocked/at-risk step -> grounded next action.
// ---------------------------------------------------------------------------

export class SopSuggestAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SopSuggestAgentError";
  }
}

const suggestionResponseSchema = z.object({
  action: z.string().trim().min(3),
  reason: z.string().trim().min(3),
  urgency: z.enum(["low", "medium", "high"]),
});

export type StepSuggestion = z.infer<typeof suggestionResponseSchema>;

export function buildSuggestPrompt(input: {
  step: SopRunStepRow;
  allSteps: SopRunStepRow[];
  run: SopRunRow;
  now?: Date;
}): string | null {
  const { step, allSteps, run } = input;
  const now = input.now ?? new Date();

  // If step is closed, return null immediately
  if (step.status === "done" || step.status === "skipped") {
    return null;
  }

  // Find prerequisite steps holding this step up
  const blockers = allSteps.filter(
    (s) =>
      step.dependsOn.includes(s.id) &&
      s.status !== "done" &&
      s.status !== "skipped",
  );

  const isLate = new Date(step.dueAt).getTime() < now.getTime();

  // Min-N / insufficient-context: if healthy and not blocked, no suggestion needed
  if (blockers.length === 0 && !isLate && step.status !== "blocked") {
    return null;
  }

  const blockerSummary =
    blockers.length > 0
      ? blockers
          .map(
            (b) =>
              `- Step "${b.title}" (status: ${b.status}, due: ${new Date(b.dueAt).toLocaleDateString()}, assignee: ${b.assigneeId ?? "unassigned"})`,
          )
          .join("\n")
      : "(None)";

  return [
    `Run context: "${run.name}" (Client: ${run.clientName ?? "Internal"})`,
    `Target Step: "${step.title}"`,
    `- Current status: ${step.status}`,
    `- Gate: ${step.gate}`,
    `- Creates: ${step.creates}`,
    `- Due date: ${new Date(step.dueAt).toLocaleDateString()} (${isLate ? "OVERDUE" : "On schedule"})`,
    `- Assignee: ${step.assigneeId ?? "Unassigned"}`,
    ``,
    `Prerequisites holding this step up:`,
    blockerSummary,
    ``,
    `Formulate concise, grounded advice on what concrete action should be taken to unblock or progress this step.`,
    `Reply strictly in JSON: {"action": string, "reason": string, "urgency": "low" | "medium" | "high"}.`,
  ].join("\n");
}

/**
 * A3 — Next-Action Suggestion for blocked or at-risk steps.
 * Grounded strictly in the run's state.
 * Returns null if step is healthy or has no actionable advice.
 */
export async function suggestNextAction(input: {
  step: SopRunStepRow;
  allSteps: SopRunStepRow[];
  run: SopRunRow;
  now?: Date;
}): Promise<StepSuggestion | null> {
  const prompt = buildSuggestPrompt(input);
  if (!prompt) return null;

  try {
    const raw = await routeAI({
      kind: "chat",
      tier: "fast",
      json: true,
      system:
        "You are an agile operations assistant giving grounded advice to unblock team workflow steps. Base recommendations strictly on the provided step dependencies and owner assignments — never invent external facts.",
      prompt,
    });

    const parsed = suggestionResponseSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (error) {
    throw new SopSuggestAgentError(
      `Could not generate next-action suggestion: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// SOP template drafting: prose description -> structured process template.
// ---------------------------------------------------------------------------

export class SopTemplateAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SopTemplateAgentError";
  }
}

const generatedStepSchema = z.object({
  tempId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  dueOffsetDays: z
    .number()
    .int()
    .min(-MAX_OFFSET_DAYS)
    .max(MAX_OFFSET_DAYS),
  gate: z.enum(SOP_STEP_GATES),
  creates: z.enum(SOP_STEP_CREATES),
  assigneeRole: z.enum(["owner", "admin", "member"]).nullable().optional(),
  dependsOnTempIds: z.array(z.string()).default([]),
});

const generatedTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  anchorLabel: z.string().trim().min(1).max(40),
  steps: z.array(generatedStepSchema).min(1).max(30),
});

export type GeneratedSopTemplate = z.infer<typeof generatedTemplateSchema>;

export function buildTemplateAgentPrompt(description: string): string {
  return [
    `Create a structured Standard Operating Procedure (SOP) process template based on this description:`,
    `"${description}"`,
    ``,
    `Requirements:`,
    `- Provide a template name, description, and anchor label (e.g. "Launch date", "Client kickoff", "Publication day").`,
    `- Provide 3 to 10 sequential or parallel steps.`,
    `- Offset days relative to anchor date: negative for prep steps (e.g. -7 for 7 days before anchor), 0 for anchor day, positive for post-anchor steps (e.g. 3 for 3 days after).`,
    `- Gate options: "none", "approval", "compliance". Use "approval" for signoffs and "compliance" for checks.`,
    `- Creates options: "none", "task", "content", "ticket", "doc".`,
    `- AssigneeRole options: "owner", "admin", "member", or null if unassigned.`,
    `- Dependencies: list previous step tempIds that this step depends on. Must be acyclic!`,
    ``,
    `Reply strictly with JSON only in this format:`,
    `{`,
    `  "name": "Process Name",`,
    `  "description": "Short overview",`,
    `  "anchorLabel": "Target Date Label",`,
    `  "steps": [`,
    `    {`,
    `      "tempId": "step-1",`,
    `      "title": "Initial Step Title",`,
    `      "description": "Step detail",`,
    `      "dueOffsetDays": -5,`,
    `      "gate": "none",`,
    `      "creates": "content",`,
    `      "assigneeRole": "member",`,
    `      "dependsOnTempIds": []`,
    `    }`,
    `  ]`,
    `}`,
  ].join("\n");
}

/**
 * Validates the acyclic graph structure of generated steps.
 */
export function validateGeneratedGraph(
  steps: z.infer<typeof generatedStepSchema>[],
): boolean {
  const nodes = steps.map((s) => ({
    id: s.tempId,
    dependsOn: s.dependsOnTempIds,
  }));

  for (const step of steps) {
    if (wouldCreateCycle(nodes, step.tempId, step.dependsOnTempIds)) {
      return false;
    }
  }
  return true;
}

/**
 * A1 — Draft a SOP template from prose.
 * Calls routeAI with quality tier, parses and validates JSON output, retrying ONCE on failure.
 * Never auto-saves — returns reviewable proposal structure for the client.
 */
export async function generateTemplateDraft(input: {
  description: string;
  workspaceId: string;
}): Promise<GeneratedSopTemplate> {
  const prompt = buildTemplateAgentPrompt(input.description);
  const system =
    "You are an expert operations architect who designs structured, actionable standard operating procedures (SOPs) for marketing, agency, and creative teams.";

  let lastError: string = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await routeAI({
        kind: "chat",
        tier: "quality",
        json: true,
        system,
        prompt:
          attempt === 1
            ? prompt
            : `${prompt}\n\nIMPORTANT: Your previous output failed validation (${lastError}). Ensure valid JSON with valid enum choices and acyclic dependencies.`,
      });

      const parsed = generatedTemplateSchema.parse(JSON.parse(raw));

      if (!validateGeneratedGraph(parsed.steps)) {
        throw new Error("Generated template step dependencies contain a cycle.");
      }

      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Invalid JSON response";
      if (attempt === 2) {
        throw new SopTemplateAgentError(
          `Could not generate a valid template from description: ${lastError}`,
        );
      }
    }
  }

  throw new SopTemplateAgentError("Failed to generate template draft.");
}
