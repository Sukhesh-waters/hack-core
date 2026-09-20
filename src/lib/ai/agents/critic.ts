import { z } from "zod";
import type { BrandIdentity, ComplianceViolation } from "@/db/schema";
import { formatDraftBody, refineDraft, type Draft } from "@/lib/ai/agents/content";
import type {
  BrandContext,
  CampaignStrategy,
  MarketIntelligence,
} from "@/lib/ai/agents/strategy";
import { routeAI } from "@/lib/ai/router";

// ---------------------------------------------------------------------------
// Compliance (W6): audit a draft against Brand DNA rules, one refinement
// retry on fail. The retry is a plain function call — no agent spawns an
// agent.
// ---------------------------------------------------------------------------

export class ComplianceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComplianceError";
  }
}

export type ComplianceCheck = {
  verdict: "pass" | "fail";
  violations: ComplianceViolation[];
};

/**
 * BrandIdentity plus the declared vault fields the merged DNA carries.
 * `bannedWords` drives the deterministic check — an LLM can miss, a
 * word-boundary regex cannot.
 */
export type ComplianceDna = BrandIdentity & { bannedWords?: string[] };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic banned-word audit: case-insensitive, word-boundary matching
 * across every draft field. Multi-word phrases match across whitespace.
 * Intentionally dumb — misspellings/synonyms are the LLM layer's job.
 */
export function findBannedWords(
  draft: Draft,
  banned: string[],
): ComplianceViolation[] {
  const fields: Array<[string, string]> = [
    ["caption", draft.caption],
    ["script", draft.script],
    ["hashtags", draft.hashtags.join(" ")],
    ["cta", draft.cta],
  ];
  const violations: ComplianceViolation[] = [];
  for (const term of banned) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(
      `\\b${trimmed.split(/\s+/).map(escapeRegExp).join("\\s+")}\\b`,
      "i",
    );
    for (const [field, text] of fields) {
      const match = pattern.exec(text);
      if (!match) continue;
      const start = Math.max(0, match.index - 20);
      violations.push({
        rule: `Banned word: "${trimmed}"`,
        excerpt: text.slice(start, match.index + match[0].length + 20).trim(),
        why: `"${trimmed}" is on the banned words list and appeared in the ${field}.`,
      });
    }
  }
  return violations;
}

const checkSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  violations: z.array(
    z.object({
      rule: z.string(),
      excerpt: z.string(),
      why: z.string(),
    }),
  ),
});

/** Compliance agent (W6): audit a draft against the Brand DNA rules. */
export async function checkCompliance(input: {
  draft: Draft;
  identity: BrandIdentity;
}): Promise<ComplianceCheck> {
  const { identity, draft } = input;
  const raw = await routeAI({
    kind: "chat",
    tier: "quality",
    json: true,
    system:
      "You are a brand compliance auditor. Flag only real rule violations — do not invent problems in clean copy.",
    prompt: [
      `Brand rules — voice: ${identity.voice}. Tone: ${identity.tone}. Audience: ${identity.audience}. Pillars: ${identity.pillars.join(", ")}. Never: ${identity.doNots.join("; ") || "(none)"}.`,
      `Draft to audit:\n${formatDraftBody(draft)}`,
      'Audit the draft against every rule. Reply with JSON only: {"verdict":"pass"|"fail","violations":[{"rule":string,"excerpt":string,"why":string}]}. verdict is "fail" only if violations is non-empty.',
    ].join("\n\n"),
  });
  try {
    return checkSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new ComplianceError(
      `Compliance check returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

export type ComplianceOutcome = {
  draft: Draft;
  verdict: "passed" | "flagged";
  violations: ComplianceViolation[];
  retried: boolean;
};

/**
 * Deterministic banned-word check first (authoritative), then the LLM audit.
 * Any banned-word hit forces a fail even when the model says pass.
 */
async function auditDraft(
  draft: Draft,
  identity: ComplianceDna,
): Promise<ComplianceCheck> {
  const deterministic = findBannedWords(draft, identity.bannedWords ?? []);
  const llm = await checkCompliance({ draft, identity });
  const violations = [...deterministic, ...llm.violations];
  return { verdict: violations.length ? "fail" : "pass", violations };
}

/**
 * Check → on fail, ONE refinement pass with the violations as feedback →
 * re-check. A second failure stays flagged for a human. The retry is a plain
 * function call from this orchestrator — no agent spawns an agent.
 */
export async function enforceCompliance(input: {
  draft: Draft;
  identity: ComplianceDna;
}): Promise<ComplianceOutcome> {
  const first = await auditDraft(input.draft, input.identity);
  if (first.verdict === "pass") {
    return {
      draft: input.draft,
      verdict: "passed",
      violations: [],
      retried: false,
    };
  }

  const feedback = `Fix these brand compliance violations: ${first.violations
    .map((v) => `${v.rule} — ${v.why} ("${v.excerpt}")`)
    .join("; ")}`;
  const revised = await refineDraft({
    draft: input.draft,
    feedback,
    identity: input.identity,
  });

  const second = await auditDraft(revised, input.identity);
  return second.verdict === "pass"
    ? { draft: revised, verdict: "passed", violations: [], retried: true }
    : {
        draft: revised,
        verdict: "flagged",
        violations: second.violations,
        retried: true,
      };
}

// ---------------------------------------------------------------------------
// Ad suitability: organic content + market trends -> paid-promotion scoring.
// Never assigns scores to pattern data, never writes to posts/baseline
// tables — output is a recommendation, not a mutation.
// ---------------------------------------------------------------------------

export type OrganicContentItem = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  pillar: string | null;
  /** Engagement rate from first-party baseline (if scored). */
  engagementRate?: number;
};

export type MarketTrendContext = {
  hooksObserved: string[];
  formatBreakdown: string[];
  topAudiences: string[];
};

export type AdSuitabilityResult = {
  contentId: string;
  suitabilityScore: number;
  hookStrength: number;
  commercialIntent: number;
  ctaQuality: number;
  audienceAlignment: number;
  reasoning: string;
  suggestedAdCopy: string;
  suggestedObjective: string;
};

const suitabilityItemSchema = z.object({
  contentId: z.string(),
  suitabilityScore: z.number().min(0).max(100),
  hookStrength: z.number().min(0).max(100),
  commercialIntent: z.number().min(0).max(100),
  ctaQuality: z.number().min(0).max(100),
  audienceAlignment: z.number().min(0).max(100),
  reasoning: z.string().min(5),
  suggestedAdCopy: z.string().min(5),
  suggestedObjective: z.enum([
    "awareness",
    "traffic",
    "engagement",
    "leads",
    "conversions",
  ]),
});

const suitabilityResponseSchema = z.object({
  rankings: z.array(suitabilityItemSchema),
});

export function buildAdSuitabilityPrompt(
  content: OrganicContentItem[],
  marketContext: MarketTrendContext,
): string {
  const contentLines = content.map(
    (c) =>
      `[Content ID: ${c.id}] title: "${c.title}"; type: ${c.type}; pillar: ${c.pillar ?? "general"}; body: ${c.body?.slice(0, 300) ?? "(no body)"}${c.engagementRate !== undefined ? `; engagement: ${(c.engagementRate * 100).toFixed(1)}%` : ""}`,
  );

  const trendLines = [
    `Hooks winning in market: ${marketContext.hooksObserved.slice(0, 5).join("; ") || "unknown"}`,
    `Formats trending: ${marketContext.formatBreakdown.slice(0, 5).join("; ") || "unknown"}`,
    `Top audiences: ${marketContext.topAudiences.slice(0, 3).join("; ") || "general"}`,
  ];

  return [
    "Evaluate the following organic content items for paid ad suitability.",
    "",
    "ORGANIC CONTENT:",
    ...contentLines,
    "",
    "CURRENT MARKET TRENDS (from competitor ad intelligence):",
    ...trendLines,
    "",
    "For each content item, score 0-100 on: hookStrength, commercialIntent, ctaQuality, audienceAlignment.",
    "Compute suitabilityScore as the weighted average (hook 30%, commercial 25%, cta 25%, audience 20%).",
    "For each, provide reasoning (why this content works or doesn't as an ad), suggestedAdCopy (a short ad copy adaptation), and suggestedObjective (awareness/traffic/engagement/leads/conversions).",
    "Rank by suitabilityScore descending. Return top items only (max 5).",
    "",
    'Reply with JSON only matching schema: {"rankings":[{"contentId":string, "suitabilityScore":number, "hookStrength":number, "commercialIntent":number, "ctaQuality":number, "audienceAlignment":number, "reasoning":string, "suggestedAdCopy":string, "suggestedObjective":"awareness"|"traffic"|"engagement"|"leads"|"conversions"}]}',
  ].join("\n");
}

/**
 * Ad Suitability Agent.
 * Evaluates organic content drafts against market trends to determine which
 * posts are best suited for paid promotion.
 */
export async function evaluateContentForAds(
  content: OrganicContentItem[],
  marketContext: MarketTrendContext,
): Promise<AdSuitabilityResult[]> {
  if (content.length === 0) return [];

  // Provide sensible defaults for empty market context
  const ctx: MarketTrendContext = {
    hooksObserved:
      marketContext.hooksObserved.length > 0
        ? marketContext.hooksObserved
        : ["problem-solution", "before-after", "listicle"],
    formatBreakdown:
      marketContext.formatBreakdown.length > 0
        ? marketContext.formatBreakdown
        : ["single image", "carousel", "short video"],
    topAudiences:
      marketContext.topAudiences.length > 0
        ? marketContext.topAudiences
        : ["general"],
  };

  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are a paid media strategist evaluating organic social content for ad suitability. Score honestly — not every post makes a good ad. Prefer content with clear hooks, commercial intent, and audience alignment with current market trends.",
    prompt: buildAdSuitabilityPrompt(content, ctx),
  });

  const parsed = suitabilityResponseSchema.parse(JSON.parse(raw));

  // Filter to valid content IDs only (prevent hallucinated IDs)
  const validIds = new Set(content.map((c) => c.id));
  return parsed.rankings
    .filter((r) => validIds.has(r.contentId))
    .sort((a, b) => b.suitabilityScore - a.suitabilityScore);
}

// ---------------------------------------------------------------------------
// Pattern insight: public pattern posts -> inspiration-only observations.
// Two-layer rule: input type accepts pattern rows only; evidence validated
// against them post-hoc.
// ---------------------------------------------------------------------------

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
 * unit test in pattern-insight.test.ts is the behavioural half.
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

// ---------------------------------------------------------------------------
// Ads insight: public competitor ads -> cited strategic synthesis.
// Cites pattern_ads IDs only; seeds inspiration topics, never a baseline.
// ---------------------------------------------------------------------------

export type PatternAdInput = {
  id: string;
  pageHandle: string;
  adBody: string | null;
  adFormat: string | null;
  targetAudience: string | null;
  postedAtIso: string;
};

const adsInsightSchema = z.object({
  summary: z.string().min(5),
  hooksObserved: z.array(z.string()),
  formatBreakdown: z.array(z.string()),
  citations: z.array(z.string()),
});

export type AdsInsightResult = z.infer<typeof adsInsightSchema>;

export function buildAdsInsightPrompt(ads: PatternAdInput[]): string {
  const adLines = ads.map(
    (a) =>
      `[Ad ID: ${a.id}] handle: ${a.pageHandle}; format: ${a.adFormat ?? "unknown"}; audience: ${a.targetAudience ?? "general"}; body: ${a.adBody ?? "(no copy)"}`,
  );

  return [
    "Analyze the following competitor ads from the public pattern layer:",
    ...adLines,
    "",
    "Provide a strategic synthesis of hooks, visual formats, and audience positioning.",
    "Rule: Every insight MUST cite pattern ad IDs from the input list above.",
    'Reply with JSON only matching schema: {"summary":string, "hooksObserved":string[], "formatBreakdown":string[], "citations":string[]}',
  ].join("\n");
}

/**
 * F3 · Ads Insight Agent.
 * Analyzes competitor ads in the pattern layer. Cites pattern_ads IDs only;
 * outputs evidence-backed observations that can seed inspiration topics.
 */
export async function analyzeCompetitorAds(
  ads: PatternAdInput[],
): Promise<AdsInsightResult> {
  if (ads.length === 0) {
    return {
      summary: "No competitor ads available for analysis.",
      hooksObserved: [],
      formatBreakdown: [],
      citations: [],
    };
  }

  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are an ad intelligence analyst synthesizing competitor creative strategies. Never fabricate performance data or baseline metrics.",
    prompt: buildAdsInsightPrompt(ads),
  });

  const parsed = adsInsightSchema.parse(JSON.parse(raw));
  // Filter citations to valid input IDs
  const validIds = new Set(ads.map((a) => a.id));
  return {
    ...parsed,
    citations: parsed.citations.filter((id) => validIds.has(id)),
  };
}

// ---------------------------------------------------------------------------
// Campaign strategy critique: the mandatory independent challenge pass for
// the campaign_strategy orchestrator flow. Reviews a proposed strategy
// against the same brand + market context the Strategy agent saw. Returns
// feedback for a human reviewer — it never rewrites the strategy itself.
// ---------------------------------------------------------------------------

export class CampaignCritiqueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignCritiqueError";
  }
}

const campaignCritiqueSchema = z.object({
  verdict: z.enum(["pass", "flagged"]),
  feedback: z.array(z.string().min(3)).max(6).default([]),
});

export type CampaignCritique = z.infer<typeof campaignCritiqueSchema>;

export function buildCampaignCritiquePrompt(
  strategy: CampaignStrategy,
  brand: BrandContext,
  market: MarketIntelligence,
): string {
  return [
    `Brand: "${brand.brandName}" — Positioning: "${brand.positioning}"`,
    `Market intelligence the strategist saw:`,
    `• Competitor hooks: ${market.competitorHooks.join("; ") || "none observed"}`,
    `• Trending formats: ${market.trendingFormats.join("; ") || "unknown"}`,
    `• Audience insights: ${market.audienceInsights.join("; ") || "general"}`,
    "",
    "Proposed campaign strategy to review:",
    `• Objective: ${strategy.recommendedObjective}`,
    `• Budget range: $${strategy.recommendedBudgetRange.min}-$${strategy.recommendedBudgetRange.max}`,
    `• Audience: ${strategy.audienceSuggestion}`,
    `• Ad copy: ${strategy.adCopyVariants.join(" | ")}`,
    `• Summary: ${strategy.strategySummary}`,
    `• Stated risks: ${strategy.keyRisks.join("; ") || "none stated"}`,
    "",
    "Independently challenge this strategy: unsupported assumptions, budget realism for the objective, audience/copy mismatch, claims not grounded in the market intelligence above, and risks the strategist missed.",
    'Reply with JSON only: {"verdict":"pass"|"flagged","feedback":string[]}. verdict is "flagged" only when feedback is non-empty. Do not invent problems in a sound plan.',
  ].join("\n");
}

/** Critic agent: independent challenge pass over a campaign strategy proposal. */
export async function critiqueCampaignStrategy(
  strategy: CampaignStrategy,
  brand: BrandContext,
  market: MarketIntelligence,
): Promise<CampaignCritique> {
  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are an independent paid-media reviewer. Challenge the proposal's assumptions, budget realism, and audience fit. Flag only real weaknesses.",
    prompt: buildCampaignCritiquePrompt(strategy, brand, market),
  });
  try {
    return campaignCritiqueSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new CampaignCritiqueError(
      `Campaign critique returned an unusable result: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
