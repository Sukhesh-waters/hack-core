"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getContentById } from "@/db/queries/clients";
import {
  listFieldsForSubject,
  setContentCustomFieldsQuery,
} from "@/db/queries/custom-fields";
import { validateCustomFieldValues } from "@/lib/custom-fields";
import { actionErrorMessage } from "@/lib/action-errors";

// ---------------------------------------------------------------------------
// F4 — save one custom-field value on a content row (calendar detail panel)
// ---------------------------------------------------------------------------

const saveCustomFieldValueSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  fieldId: z.string().min(1),
  value: z.unknown(),
});

export type SaveCustomFieldValueResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Writes ONE custom field's value onto a content row's `customFields` jsonb.
 *
 * Two things this deliberately gets right:
 *
 * 1. The submitted `fieldId` is only ever written if it names a LIVE
 *    definition assigned to "content" in THIS workspace
 *    (listFieldsForSubject already scopes by workspace and excludes
 *    archived fields). Writing whatever key the client sends would let a
 *    crafted request stash an arbitrary jsonb key under customFields —
 *    rejecting unknown ids is the injection guard, not an edge case.
 * 2. The write MERGES into the row's existing customFields rather than
 *    replacing it. The panel edits one field at a time; replacing the
 *    whole object would silently wipe every other field's value the panel
 *    didn't happen to have loaded.
 */
export async function saveCustomFieldValueAction(input: {
  workspaceId: string;
  contentId: string;
  fieldId: string;
  value: unknown;
}): Promise<SaveCustomFieldValueResult> {
  const parsed = saveCustomFieldValueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Missing field reference." };
  }
  const { workspaceId, contentId, fieldId, value } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { ok: false, error: "That row is no longer available." };

    const definitions = await listFieldsForSubject(workspaceId, "content");
    const definition = definitions.find((d) => d.id === fieldId);
    if (!definition) {
      return { ok: false, error: "That field no longer exists." };
    }

    const validated = validateCustomFieldValues(
      [definition],
      { [fieldId]: value },
    );
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.errors[fieldId] ?? "That value isn't valid.",
      };
    }

    const existing = (row.customFields ?? {}) as Record<string, unknown>;
    const merged = {
      ...existing,
      [fieldId]: validated.values[fieldId] ?? null,
    };

    const updated = await setContentCustomFieldsQuery({
      workspaceId,
      contentId,
      merged,
    });
    if (updated.length === 0) {
      return { ok: false, error: "That row is no longer available." };
    }
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/calendar`);
  return { ok: true };
}
