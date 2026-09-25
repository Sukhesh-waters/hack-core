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

/** Cut to `max` characters at the last word boundary, with an ellipsis. */
export function fitWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

const itemSchema = z.object({
  // Too long is trimmed at a word boundary, not rejected: live 2026-09-21 two
  // Waters runs lost ALL their directions because one title ran past 80
  // characters. Too short is still a real defect and still rejected.
  title: z.string().trim().min(3).transform((s) => fitWords(s, 80)),
  summary: z.string().trim().min(10).transform((s) => fitWords(s, 400)),
  severity: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  brandChunkIds: z.array(z.string()).default([]),
  brainChunkIds: z.array(z.string()).default([]),
});

/**
 * The envelope only. Items are checked one by one below: live 2026-09-21 a
 * Bruker run was degraded because the model answered `"items": null` (it had
 * nothing to propose), and one malformed item used to discard its siblings.
 */
const MAX_ITEMS = 5;
const responseSchema = z.object({ items: z.array(z.unknown()).nullable() });

export type CitedItem = z.infer<typeof itemSchema>;

/** Anything that answers "is this id citable" (a Set, or a label resolver). */
type IdSet = Pick<ReadonlySet<string>, "has">;

export type CitationRule = {
  brand: IdSet;
  brain: IdSet;
  /** Which lists must be non-empty for an item to stand. */
  require: { brand: boolean; brain: boolean };
};

/**
 * Short citation labels (P1, P2, ...) in place of 36-character ids. Live
 * 2026-09-23: six Waters runs degraded because a fallback model miscopied the
 * UUIDs and every direction was rejected. `resolve` maps a label (or the real
 * id, still accepted) back to the real id; anything else stays unknown.
 */
export function aliasRows(
  rows: EvidenceRow[],
  prefix: string,
): { rows: EvidenceRow[]; resolve: (id: string) => string | null } {
  const toReal = new Map<string, string>();
  const aliased = rows.map((r, i) => {
    const label = `${prefix}${i + 1}`;
    toReal.set(label, r.id);
    toReal.set(r.id, r.id);
    return { id: label, content: r.content };
  });
  return {
    rows: aliased,
    resolve: (id) => toReal.get(id.trim().replace(/^\[|\]$/g, "").trim()) ?? null,
  };
}

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
  for (const raw of (parsed.items ?? []).slice(0, MAX_ITEMS)) {
    const checked = itemSchema.safeParse(raw);
    if (!checked.success) {
      rejected += 1;
      continue;
    }
    const item = checked.data;
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
