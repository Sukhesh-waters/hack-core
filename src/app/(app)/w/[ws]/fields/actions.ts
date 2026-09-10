"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, max } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { customFieldAssignments, customFieldDefinitions } from "@/db/schema";
import { requireCapability } from "@/db/queries/memberships";
import { archiveFieldQuery } from "@/db/queries/custom-fields";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  CUSTOM_FIELD_SUBJECTS,
  customFieldDefinitionSchema,
  type CustomFieldSubject,
} from "@/lib/custom-fields";

export type FieldAdminState = { error?: string } | undefined;

function isCustomFieldSubject(value: string): value is CustomFieldSubject {
  return (CUSTOM_FIELD_SUBJECTS as readonly string[]).includes(value);
}

/** One option per line in the textarea — blank lines dropped, not an
 *  encoding of "empty option". */
function parseOptionsInput(raw: FormDataEntryValue | null): string[] | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  return raw
    .split("\n")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function requireWorkspaceId(formData: FormData): string | { error: string } {
  const workspaceId = formData.get("workspaceId");
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  return workspaceId;
}

/**
 * Creates a field definition AND attaches it to every selected subject type
 * in one transaction. A definition with no assignments is a field attached
 * to nothing — dead data nobody can find again — so the two writes either
 * both land or neither does.
 */
export async function createFieldAction(
  _prev: FieldAdminState,
  formData: FormData,
): Promise<FieldAdminState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const parsed = customFieldDefinitionSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || null,
    type: formData.get("type"),
    options: parseOptionsInput(formData.get("options")),
    required: formData.get("required") === "on",
    subjects: formData.getAll("subjects").map(String),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "field.edit");

    await db.transaction(async (tx) => {
      const [definition] = await tx
        .insert(customFieldDefinitions)
        .values({
          workspaceId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          type: parsed.data.type,
          options: parsed.data.options ?? null,
          required: parsed.data.required,
        })
        .returning({ id: customFieldDefinitions.id });

      // position defaults to 0, which is only correct for the very first
      // field on a subject — every field after that would tie at 0 and the
      // list would silently fall back to alphabetical (fieldsForSubjectQuery
      // orders by position, then name). Append each new field after
      // whatever already has the highest position FOR THAT SUBJECT — each
      // subject keeps its own independent ordering, so attaching one field
      // to two subjects at once doesn't let one list's length dictate the
      // other's position. One query up front (grouped by subject), then the
      // usual single batched insert — not one extra query per subject.
      const existingMax =
        parsed.data.subjects.length === 0
          ? []
          : await tx
              .select({
                subjectType: customFieldAssignments.subjectType,
                highest: max(customFieldAssignments.position),
              })
              .from(customFieldAssignments)
              .where(
                and(
                  eq(customFieldAssignments.workspaceId, workspaceId),
                  inArray(customFieldAssignments.subjectType, parsed.data.subjects),
                ),
              )
              .groupBy(customFieldAssignments.subjectType);

      const nextPositionFor = new Map<string, number>(
        existingMax.map((row) => [row.subjectType, (row.highest ?? -1) + 1]),
      );

      await tx.insert(customFieldAssignments).values(
        parsed.data.subjects.map((subjectType) => {
          const position = nextPositionFor.get(subjectType) ?? 0;
          // Guards against the same subject somehow appearing twice in one
          // submission — each row still gets its own increasing position.
          nextPositionFor.set(subjectType, position + 1);
          return {
            workspaceId,
            fieldId: definition.id,
            subjectType,
            position,
          };
        }),
      );
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/fields`);
  return undefined;
}

/** Soft-retires a definition. Reports a lost race rather than a generic
 *  failure when someone else already archived it — 0 rows back means the
 *  guard in archiveFieldQuery (isNull(archivedAt)) didn't match. */
export async function archiveFieldAction(
  _prev: FieldAdminState,
  formData: FormData,
): Promise<FieldAdminState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const fieldId = formData.get("fieldId");
  if (typeof fieldId !== "string" || fieldId.length === 0) {
    return { error: "Missing field" };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "field.edit");
    const rows = await archiveFieldQuery(workspaceId, fieldId);
    if (rows.length === 0) {
      return {
        error: "That field was already archived (or removed) by someone else.",
      };
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/fields`);
  return undefined;
}

/**
 * Attaches an EXISTING field definition to another subject type — the
 * "reuse a field across types" capability. Ownership is re-checked here
 * (fieldId + workspaceId) rather than trusted from the client: a field id
 * alone is not proof it belongs to this workspace, and skipping this check
 * would let one workspace attach another's field by guessing its id.
 */
export async function assignFieldAction(
  _prev: FieldAdminState,
  formData: FormData,
): Promise<FieldAdminState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const fieldId = formData.get("fieldId");
  if (typeof fieldId !== "string" || fieldId.length === 0) {
    return { error: "Missing field" };
  }
  const subjectType = formData.get("subjectType");
  if (typeof subjectType !== "string" || !isCustomFieldSubject(subjectType)) {
    return { error: "Invalid subject type" };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "field.edit");

    const [owned] = await db
      .select({ id: customFieldDefinitions.id })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, fieldId),
          eq(customFieldDefinitions.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!owned) {
      return { error: "Field not found in this workspace." };
    }

    await db
      .insert(customFieldAssignments)
      .values({ workspaceId, fieldId, subjectType })
      .onConflictDoNothing();
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/fields`);
  return undefined;
}

/** Detaches a field from one subject type without touching the definition
 *  or any other subject type it's attached to. */
export async function unassignFieldAction(
  _prev: FieldAdminState,
  formData: FormData,
): Promise<FieldAdminState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const fieldId = formData.get("fieldId");
  if (typeof fieldId !== "string" || fieldId.length === 0) {
    return { error: "Missing field" };
  }
  const subjectType = formData.get("subjectType");
  if (typeof subjectType !== "string" || !isCustomFieldSubject(subjectType)) {
    return { error: "Invalid subject type" };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "field.edit");

    await db
      .delete(customFieldAssignments)
      .where(
        and(
          eq(customFieldAssignments.workspaceId, workspaceId),
          eq(customFieldAssignments.fieldId, fieldId),
          eq(customFieldAssignments.subjectType, subjectType),
        ),
      );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/fields`);
  return undefined;
}
