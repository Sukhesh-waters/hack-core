"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { DISMISS_REASONS, type SuggestionEventKind } from "@/db/platina-schema";
import { requireMembership } from "@/db/queries/memberships";
import { setBrainChunksStatus, suggestionByIdQuery } from "@/db/queries/platina-learning";
import { runConsolidation } from "@/lib/platina/learning-engine";
import { recordDecision, recordSubjectDecision } from "@/lib/platina/suggestions-record";

const DECISIONS = new Set<SuggestionEventKind>(["accepted", "dismissed"]);

/** Only a path inside this workspace's Platina pages is a place to go back to. */
function backTo(ws: string, raw: FormDataEntryValue | null, params: Record<string, string> = {}): never {
  const path = String(raw ?? "");
  const safe = path.startsWith(`/p/${ws}/`) && !path.includes("//") ? path.split("?")[0] : `/p/${ws}/learning`;
  const query = new URLSearchParams(params).toString();
  redirect(query ? `${safe}?${query}` : safe);
}

/**
 * A person's decision on a suggestion (C8.5): "useful" or "dismiss, because
 * ...". "Wrong fact" names the input that was wrong, so only its trust drops.
 * By id (Learning page) or by subject (an Opportunities card).
 */
export async function suggestionFeedbackAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const user = await requireUser();
  await requireMembership(ws, user.id);
  const kind = String(formData.get("decision") ?? "") as SuggestionEventKind;
  if (!DECISIONS.has(kind)) backTo(ws, formData.get("back"), { error: "Unknown decision." });
  const reason = kind === "dismissed" ? String(formData.get("reason") ?? "not_relevant") : null;
  if (reason && !(DISMISS_REASONS as readonly string[]).includes(reason)) backTo(ws, formData.get("back"), { error: "Unknown reason." });
  const ref = String(formData.get("ref") ?? "").trim();
  const detail = reason === "wrong_fact" && ref ? { ref } : {};

  const id = String(formData.get("suggestionId") ?? "");
  const subject = String(formData.get("subjectKey") ?? "");
  let recorded = false;
  if (id) {
    const [s] = await suggestionByIdQuery(ws, id);
    if (s) recorded = await recordDecision({ workspaceId: ws, suggestionId: s.id, kind, reason, actorId: user.id, detail });
  } else if (subject) {
    recorded = (await recordSubjectDecision(ws, "opportunity", subject, { kind, reason, actorId: user.id, detail })) !== null;
  }
  revalidatePath(`/p/${ws}/learning`);
  backTo(ws, formData.get("back"), recorded ? { noted: kind } : { error: "Already noted today, or that suggestion is not in the ledger yet." });
}

/** Monthly consolidation by hand: a dry run shows the plan; "run now" applies it (once a month). */
export async function consolidateAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const user = await requireUser();
  await requireMembership(ws, user.id);
  const apply = formData.get("mode") === "apply";
  if (!apply) redirect(`/p/${ws}/learning?dry=1#consolidation`);
  const result = await runConsolidation(ws, { apply: true });
  revalidatePath(`/p/${ws}/learning`);
  redirect(
    `/p/${ws}/learning?${new URLSearchParams(result.applied ? { consolidated: result.month } : { error: `${result.month} was already consolidated; the next run is on the 1st.` })}#consolidation`,
  );
}

/** Puts a retired Brain insight back into use. */
export async function restoreInsightAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const user = await requireUser();
  await requireMembership(ws, user.id);
  const id = String(formData.get("chunkId") ?? "");
  if (id) await setBrainChunksStatus(ws, [id], "active");
  revalidatePath(`/p/${ws}/learning`);
  redirect(`/p/${ws}/learning#consolidation`);
}
