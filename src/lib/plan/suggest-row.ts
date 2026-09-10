import { z } from "zod";
import type { BrandIdentity } from "@/db/schema";
import { routeAI } from "@/lib/ai/router";
import type { DriverPost } from "@/lib/ai/retrieval";

export class PlanSuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanSuggestionError";
  }
}

/**
 * What the model is told about the row it is advising on.
 *
 * Note what this type CANNOT carry: there is no field for pattern rows,
 * competitor posts, or scraped inspiration. The two-layer rule is enforced
 * here by shape, not by discipline — a caller cannot pass pattern data into
 * this prompt even by mistake, because there is nowhere to put it.
 */
export type PlanRowContext = {
  clientName: string;
  title: string;
  type: string;
  durationSec: number | null;
  pillar: string | null;
  strategyNote: string | null;
  scheduledForIso: string | null;
};

/** The subset of plan fields a suggestion may propose. Never status,
 *  complianceStatus or productionStage — those are workflow, not plan. */
export type PlanSuggestion = {
  title?: string;
  type?: string;
  durationSec?: number | null;
  pillar?: string;
  strategyNote?: string;
};

const responseSchema = z.object({
  title: z.string().min(3).max(140).optional(),
  type: z.string().min(2).max(40).optional(),
  durationSec: z.number().int().positive().max(7200).nullable().optional(),
  pillar: z.string().min(2).max(120).optional(),
  strategyNote: z.string().min(3).max(2000).optional(),
});

/**
 * Phrases that assert first-party evidence. Under min-N there is no baseline
 * to back them, so a suggestion using them would be exactly the "confident
 * 'your data shows' copy with no baseline" the constitution forbids.
 *
 * Deterministic check, not a second model call — the compliance retry cap
 * exists for the same reason: no agent spawns an agent.
 */
const EVIDENCE_PHRASES = [
  "your data",
  "your baseline",
  "your analytics",
  "data shows",
  "analytics show",
  "top-performing",
  "top performing",
  "best-performing",
  "best performing",
  "outperform",
  "historically",
  "past posts",
  "previous posts",
  "engagement data",
  "performance data",
  "we've seen",
  "we have seen",
  "proven to",
];

export function containsEvidenceLanguage(text: string): boolean {
  const haystack = text.toLowerCase();
  return EVIDENCE_PHRASES.some((phrase) => haystack.includes(phrase));
}

export const PLAN_DECLARED_ONLY_NOTE =
  "Declared brand context (no baseline yet)";

/**
 * Declared-only mode: the suggestion ran on human-declared brand context
 * alone. Any field that claims performance evidence is dropped rather than
 * stored — a missing suggestion is honest, a fabricated one is not.
 */
export function markPlanDeclaredOnly(
  suggestion: PlanSuggestion,
): PlanSuggestion {
  const cleaned: PlanSuggestion = { ...suggestion };
  if (cleaned.strategyNote && containsEvidenceLanguage(cleaned.strategyNote)) {
    delete cleaned.strategyNote;
  }
  if (cleaned.pillar && containsEvidenceLanguage(cleaned.pillar)) {
    delete cleaned.pillar;
  }
  if (cleaned.title && containsEvidenceLanguage(cleaned.title)) {
    delete cleaned.title;
  }
  return cleaned;
}

/** True when the model returned nothing usable after the declared-only scrub. */
export function isEmptySuggestion(suggestion: PlanSuggestion): boolean {
  return Object.values(suggestion).every((v) => v === undefined);
}

export function buildPlanSuggestionPrompt(input: {
  row: PlanRowContext;
  identity: BrandIdentity;
  brief: string;
  drivers: DriverPost[];
  declaredOnly: boolean;
}): string {
  const { row, identity } = input;
  const lines = [
    `Client: ${row.clientName}`,
    [
      "Current plan row —",
      `title: ${row.title || "(untitled)"};`,
      `format: ${row.type};`,
      `duration: ${row.durationSec === null ? "(none)" : `${row.durationSec}s`};`,
      `pillar: ${row.pillar ?? "(none)"};`,
      `strategy note: ${row.strategyNote ?? "(none)"};`,
      `scheduled: ${row.scheduledForIso ?? "(no date)"}`,
    ].join(" "),
    `Brand DNA — voice: ${identity.voice}. Tone: ${identity.tone}. Audience: ${identity.audience}. Pillars: ${identity.pillars.join(", ")}. Never: ${identity.doNots.join("; ") || "(none)"}.`,
    `Driver brief (first-party evidence):\n${input.brief}`,
  ];

  if (input.declaredOnly) {
    lines.push(
      "There is NO first-party performance baseline for this client yet. " +
        "Advise strictly from the declared brand context above. Do not claim " +
        "or imply performance evidence — no 'your data shows', no " +
        "'top-performing', no historical comparisons of any kind.",
    );
  }

  lines.push(
    "Suggest improvements to this single plan row. Only include a field if " +
      "you would genuinely change it — omit anything already good. " +
      'Reply with JSON only: {"title"?:string,"type"?:string,' +
      '"durationSec"?:number|null,"pillar"?:string,"strategyNote"?:string}. ' +
      "durationSec applies only to video formats (reel, talking_head, " +
      "motion_graphic) and must be null otherwise.",
  );

  return lines.join("\n\n");
}

/**
 * One suggestion for one row. Routed through the model router like every
 * other AI call — no direct provider SDK at this call site.
 */
export async function suggestPlanRow(input: {
  row: PlanRowContext;
  identity: BrandIdentity;
  brief: string;
  drivers: DriverPost[];
  declaredOnly: boolean;
}): Promise<PlanSuggestion> {
  const raw = await routeAI({
    kind: "chat",
    tier: "fast",
    json: true,
    system:
      "You are a senior social content strategist advising on one row of a " +
      "content plan. Be specific and on-brand. Never invent performance data.",
    prompt: buildPlanSuggestionPrompt(input),
  });

  let parsed: PlanSuggestion;
  try {
    parsed = responseSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new PlanSuggestionError(
      `The suggestion came back unusable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  return input.declaredOnly ? markPlanDeclaredOnly(parsed) : parsed;
}
