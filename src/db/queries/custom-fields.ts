import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  customFieldAssignments,
  customFieldDefinitions,
  content,
} from "@/db/schema";
import type {
  CustomFieldDefinition,
  CustomFieldSubject,
  CustomFieldType,
} from "@/lib/custom-fields";

// A workspace with more configured fields than this has a taxonomy problem,
// not a tooling problem. The cap keeps every field read bounded.
const FIELDS_CAP = 100;

/**
 * Fields attached to one subject type, in display order.
 *
 * Archived definitions are excluded: they stop being offered on forms but
 * stay resolvable by id, so values already stored under them still render
 * rather than vanishing from a row that legitimately has them.
 */
export function fieldsForSubjectQuery(
  workspaceId: string,
  subjectType: CustomFieldSubject,
) {
  return db
    .select({
      id: customFieldDefinitions.id,
      name: customFieldDefinitions.name,
      description: customFieldDefinitions.description,
      type: customFieldDefinitions.type,
      options: customFieldDefinitions.options,
      required: customFieldDefinitions.required,
      position: customFieldAssignments.position,
    })
    .from(customFieldAssignments)
    .innerJoin(
      customFieldDefinitions,
      eq(customFieldDefinitions.id, customFieldAssignments.fieldId),
    )
    .where(
      and(
        eq(customFieldAssignments.workspaceId, workspaceId),
        eq(customFieldAssignments.subjectType, subjectType),
        isNull(customFieldDefinitions.archivedAt),
      ),
    )
    .orderBy(asc(customFieldAssignments.position), asc(customFieldDefinitions.name))
    .limit(FIELDS_CAP);
}

export async function listFieldsForSubject(
  workspaceId: string,
  subjectType: CustomFieldSubject,
): Promise<CustomFieldDefinition[]> {
  const rows = await fieldsForSubjectQuery(workspaceId, subjectType);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type as CustomFieldType,
    options: r.options ?? null,
    required: r.required,
  }));
}

/** Every field in the workspace — the library the admin UI reuses from. */
export function allFieldsQuery(workspaceId: string) {
  return db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.workspaceId, workspaceId),
        isNull(customFieldDefinitions.archivedAt),
      ),
    )
    .orderBy(asc(customFieldDefinitions.name))
    .limit(FIELDS_CAP);
}

/**
 * Writes validated values onto a content row.
 *
 * Merges rather than replaces. A form that only renders the fields for one
 * subject type would otherwise wipe values belonging to fields it never
 * showed — the caller passes the subset it validated, not the whole map.
 */
export function setContentCustomFieldsQuery(input: {
  workspaceId: string;
  contentId: string;
  merged: Record<string, unknown>;
}) {
  return db
    .update(content)
    .set({ customFields: input.merged })
    .where(
      and(
        eq(content.workspaceId, input.workspaceId),
        eq(content.id, input.contentId),
      ),
    )
    .returning({ id: content.id });
}

/** Soft-retire. Values stored under this field stay readable by id. */
export function archiveFieldQuery(workspaceId: string, fieldId: string) {
  return db
    .update(customFieldDefinitions)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(customFieldDefinitions.workspaceId, workspaceId),
        eq(customFieldDefinitions.id, fieldId),
        isNull(customFieldDefinitions.archivedAt),
      ),
    )
    .returning({ id: customFieldDefinitions.id });
}
