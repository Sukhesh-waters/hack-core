/**
 * Writes the suggestion ledger (C8.5 T85.2). Best-effort by design: a page
 * that shows suggestions must render the same whether or not the ledger
 * write succeeds, so every function here catches and returns null.
 * Server-only: writes the DB.
 */
import type { SuggestionEventKind, SuggestionKind } from "@/db/platina-schema";
import {
  latestSuggestionsForSubjectsQuery,
  recordSuggestionEventRow,
  recordSuggestionRow,
  setSuggestionStatus,
} from "@/db/queries/platina-learning";
import { inputHash, type SuggestionDraft } from "./suggestions";

const today = (now: Date) => now.toISOString().slice(0, 10);

/** Records each suggestion (once per inputs) and a "shown" event (once a day). Returns subject -> id. */
export async function recordShown(
  workspaceId: string,
  brandId: string | null,
  drafts: SuggestionDraft[],
  now: Date = new Date(),
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  try {
    for (const d of drafts) {
      const { id } = await recordSuggestionRow({ workspaceId, brandId, ...d, inputHash: inputHash(d) });
      ids.set(d.subjectKey, id);
      await recordSuggestionEventRow({ workspaceId, suggestionId: id, kind: "shown", day: today(now) });
    }
  } catch (error) {
    console.warn("[platina] suggestion ledger write skipped:", error instanceof Error ? error.message : error);
  }
  return ids;
}

/** Records one suggestion (a brief, an idea) without a "shown" event. */
export async function recordSuggestion(workspaceId: string, brandId: string | null, d: SuggestionDraft): Promise<string | null> {
  try {
    return (await recordSuggestionRow({ workspaceId, brandId, ...d, inputHash: inputHash(d) })).id;
  } catch (error) {
    console.warn("[platina] suggestion ledger write skipped:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * A decision on the card a person is looking at, found by its subject (an
 * opportunity's key): the newest record of it. Null when it was never shown.
 */
export async function recordSubjectDecision(
  workspaceId: string,
  kind: SuggestionKind,
  subjectKey: string,
  decision: { kind: SuggestionEventKind; reason?: string | null; reward?: number | null; actorId?: string | null; detail?: Record<string, unknown> },
): Promise<string | null> {
  try {
    const [latest] = await latestSuggestionsForSubjectsQuery(workspaceId, kind, [subjectKey]);
    if (!latest) return null;
    await recordDecision({ workspaceId, suggestionId: latest.id, ...decision });
    return latest.id;
  } catch (error) {
    console.warn("[platina] suggestion decision not recorded:", error instanceof Error ? error.message : error);
    return null;
  }
}

const STATUS: Partial<Record<SuggestionEventKind, string>> = { accepted: "accepted", planned: "planned", dismissed: "dismissed" };

/** A person's decision on a suggestion, or a result. Moves its status. */
export async function recordDecision(input: {
  workspaceId: string;
  suggestionId: string;
  kind: SuggestionEventKind;
  reason?: string | null;
  reward?: number | null;
  actorId?: string | null;
  detail?: Record<string, unknown>;
  now?: Date;
}): Promise<boolean> {
  try {
    const recorded = await recordSuggestionEventRow({
      workspaceId: input.workspaceId,
      suggestionId: input.suggestionId,
      kind: input.kind,
      reason: input.reason ?? null,
      reward: input.reward ?? null,
      actorId: input.actorId ?? null,
      detail: input.detail,
      day: today(input.now ?? new Date()),
    });
    const status = STATUS[input.kind];
    if (status) await setSuggestionStatus(input.workspaceId, input.suggestionId, status);
    return recorded;
  } catch (error) {
    console.warn("[platina] suggestion decision not recorded:", error instanceof Error ? error.message : error);
    return false;
  }
}
