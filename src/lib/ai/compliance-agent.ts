import { z } from "zod";
import type { BrandIdentity, ComplianceViolation } from "@/db/schema";
import {
  formatDraftBody,
  refineDraft,
  type Draft,
} from "@/lib/ai/generation-agent";
import { routeAI } from "@/lib/ai/router";

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
