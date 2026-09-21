/**
 * Citation discipline shared by the analysis stages (core spine S5). An
 * uncited finding is unfalsifiable, so it is rejected — never stored. Two
 * evidence lists are kept apart on purpose: first-party brand chunks (Plane A)
 * and public-signal-derived Brain chunks (Plane B) are never merged.
 */
import { extractJson } from "../json";
import { z } from "zod";
import type { PlatinaFindingEvidence } from "@/db/platina-schema";

export type EvidenceRow = { id: string; content: string };

const itemSchema = z.object({
  title: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(10).max(400),
  severity: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  brandChunkIds: z.array(z.string()).default([]),
  brainChunkIds: z.array(z.string()).default([]),
});

const responseSchema = z.object({ items: z.array(itemSchema).max(5) });

export type CitedItem = z.infer<typeof itemSchema>;

export type CitationRule = {
  brand: Set<string>;
  brain: Set<string>;
  /** Which lists must be non-empty for an item to stand. */
  require: { brand: boolean; brain: boolean };
};

/** Renders rows as `[id] text` lines the model can cite verbatim. */
export function renderEvidence(label: string, rows: EvidenceRow[]): string {
  if (rows.length === 0) return `${label}: none.`;
  return [
    `${label}:`,
    ...rows.map(
      (r) => `[${r.id}] ${r.content.replace(/\s+/g, " ").slice(0, 400)}`,
    ),
  ].join("\n");
}

/**
 * Parses a model reply into valid cited items. `rejected` counts items dropped
 * for missing or unknown ids. Throws when the reply is not the expected JSON,
 * so the stage degrades the run instead of storing nothing silently.
 */
export function parseCited(
  raw: string,
  rule: CitationRule,
): { items: CitedItem[]; rejected: number } {
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(extractJson(raw));
  } catch (error) {
    throw new Error(
      `model reply was not the expected JSON: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
    );
  }
  const items: CitedItem[] = [];
  let rejected = 0;
  for (const item of parsed.items) {
    const brandOk =
      item.brandChunkIds.every((id) => rule.brand.has(id)) &&
      (!rule.require.brand || item.brandChunkIds.length > 0);
    const brainOk =
      item.brainChunkIds.every((id) => rule.brain.has(id)) &&
      (!rule.require.brain || item.brainChunkIds.length > 0);
    if (brandOk && brainOk) items.push(item);
    else rejected += 1;
  }
  return { items, rejected };
}

export const toEvidence = (item: CitedItem): PlatinaFindingEvidence => ({
  brandChunkIds: item.brandChunkIds,
  brainChunkIds: item.brainChunkIds,
});

export type StageFindingInput = {
  workspaceId: string;
  useCase: string;
  title: string;
  summary: string;
  severity: CitedItem["severity"];
  evidence: PlatinaFindingEvidence;
  status: "new";
};
