/**
 * B7 token budget. Pure, DB-free.
 *
 * Prevents information overload: an unbounded evidence list blowing the
 * prompt past what the model can actually use, and drowning the one or two
 * items that matter in the rest. Every section gets a cap; items are kept
 * whole from the top until the cap, never cut mid-text, and the bottom is
 * dropped rather than truncated.
 */
/**
 * ~4 chars/token — the same formula as `src/lib/ai/pricing.ts
 * estimateTokens()` (the cockpit's estimate). Duplicated rather than
 * imported: the Platina boundary (`boundary.test.ts`) only allows
 * `@/lib/ai/router`, `@/lib/ai/context/types` and `@/lib/ai/usage-context`
 * from `@/lib/ai/*`; `pricing.ts` is not on that allowlist.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export type BudgetItem = { id: string; text: string };

export type SectionBudget = {
  /** Token cap for this section. `Infinity` means uncapped (the fixed prompt). */
  cap: number;
  /** Optional cap on item count (the disconfirming slot: 1 chunk). */
  maxItems?: number;
  /** Kept whole even when over cap; the result just reports it as over. */
  alwaysInclude?: boolean;
};

export type SectionResult = {
  kept: BudgetItem[];
  dropped: { id: string; tokens: number }[];
  totalTokens: number;
  over: boolean;
};

export type FitSectionsResult = {
  sections: Record<string, SectionResult>;
  totalTokens: number;
};

/**
 * Planner default budget (plan §5 B7 table). Derived hypotheses are capped
 * by `diversify.ts capDerived()` at <= `derivedShare` of the SAME 2,400-token
 * evidence budget (not a separate 2,400) — `derivedHypotheses.cap` here is
 * the resulting absolute number, kept for reference/validation by callers.
 */
export const EVIDENCE_TOKEN_BUDGET = 2400;
export const DERIVED_SHARE = 0.4;

export const PLANNER_BUDGET: Record<
  | "clientStandard"
  | "evidence"
  | "derivedHypotheses"
  | "disconfirming"
  | "lessonsPatterns"
  | "instructions",
  SectionBudget
> = {
  // Profile + confirmed brand standard.
  clientStandard: { cap: 400, alwaysInclude: true },
  // First-party evidence: the largest share of the evidence budget.
  evidence: { cap: EVIDENCE_TOKEN_BUDGET, alwaysInclude: false },
  // Derived (Brain) hypotheses: <= 40% of the evidence budget (B6).
  derivedHypotheses: { cap: EVIDENCE_TOKEN_BUDGET * DERIVED_SHARE, alwaysInclude: false },
  // One counter-evidence chunk, no separate token cap.
  disconfirming: { cap: Infinity, maxItems: 1, alwaysInclude: false },
  // Lessons + learned patterns.
  lessonsPatterns: { cap: 500, alwaysInclude: true },
  // The prompt itself: fixed, never trimmed.
  instructions: { cap: Infinity, alwaysInclude: true },
};

function fitOneSection(items: BudgetItem[], cfg: SectionBudget): SectionResult {
  if (cfg.alwaysInclude) {
    const totalTokens = items.reduce((s, i) => s + estimateTokens(i.text), 0);
    const overCount = cfg.maxItems !== undefined && items.length > cfg.maxItems;
    return { kept: items, dropped: [], totalTokens, over: totalTokens > cfg.cap || overCount };
  }

  const kept: BudgetItem[] = [];
  const dropped: { id: string; tokens: number }[] = [];
  let totalTokens = 0;
  let stopped = false; // once true, every remaining item is "the bottom" and is dropped
  for (const item of items) {
    const tokens = estimateTokens(item.text);
    const overCount = cfg.maxItems !== undefined && kept.length >= cfg.maxItems;
    if (stopped || overCount || totalTokens + tokens > cfg.cap) {
      stopped = true;
      dropped.push({ id: item.id, tokens });
      continue;
    }
    kept.push(item);
    totalTokens += tokens;
  }
  return { kept, dropped, totalTokens, over: false };
}

/**
 * Per section, keep whole items from the top until the section's cap; never
 * cut an item mid-text — once an item does not fit, it and everything after
 * it (the bottom of that section's list) are dropped. Always-included
 * sections keep every item regardless and are reported `over` instead.
 * `sections` maps a section key to its ordered (most-important-first) items;
 * `budget` maps the same keys to their caps (e.g. `PLANNER_BUDGET`). A key
 * present in `sections` but absent from `budget` is treated as uncapped.
 */
export function fitSections(
  sections: Record<string, BudgetItem[]>,
  budget: Record<string, SectionBudget>,
): FitSectionsResult {
  const result: Record<string, SectionResult> = {};
  let totalTokens = 0;
  for (const [key, items] of Object.entries(sections)) {
    const cfg = budget[key] ?? { cap: Infinity, alwaysInclude: true };
    const section = fitOneSection(items, cfg);
    result[key] = section;
    totalTokens += section.totalTokens;
  }
  return { sections: result, totalTokens };
}
