import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { allFieldsQuery, listFieldsForSubject } from "@/db/queries/custom-fields";
import {
  CUSTOM_FIELD_SUBJECTS,
  type CustomFieldDefinition,
  type CustomFieldSubject,
  type CustomFieldType,
} from "@/lib/custom-fields";
import { FieldAdmin, type LibraryField } from "./field-admin";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Fields" };
export const dynamic = "force-dynamic";

export default async function FieldsPage({
  params,
}: {
  params: { ws: string };
}) {
  const user = await requireUser();
  await requireMembership(params.ws, user.id);

  const subjectFieldLists = await Promise.all(
    CUSTOM_FIELD_SUBJECTS.map((subject) =>
      listFieldsForSubject(params.ws, subject),
    ),
  );
  const subjectFields = Object.fromEntries(
    CUSTOM_FIELD_SUBJECTS.map((subject, i) => [subject, subjectFieldLists[i]]),
  ) as Record<CustomFieldSubject, CustomFieldDefinition[]>;

  // Invert subjectFields into "which subjects is this field currently
  // attached to" — that's what lets the library tell reuse from detach.
  const assignedSubjectsByField = new Map<string, CustomFieldSubject[]>();
  for (const subject of CUSTOM_FIELD_SUBJECTS) {
    for (const field of subjectFields[subject]) {
      const list = assignedSubjectsByField.get(field.id) ?? [];
      list.push(subject);
      assignedSubjectsByField.set(field.id, list);
    }
  }

  const allFieldRows = await allFieldsQuery(params.ws);
  const library: LibraryField[] = allFieldRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as CustomFieldType,
    options: row.options ?? null,
    required: row.required,
    assignedSubjects: assignedSubjectsByField.get(row.id) ?? [],
  }));

  return (
    <PageShell width="app">
    <div>
      <p className="label-mono text-brand-teal">Fields</p>
      <h1 className="mt-2 font-display text-4xl">Custom field admin</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground/70">
        Define a field once, then attach it to as many subject types as make
        sense — content, ideas, tickets, campaigns, or clients. Archiving
        retires a field from new forms without deleting values already
        stored under it.
      </p>

      <FieldAdmin
        workspaceId={params.ws}
        subjectFields={subjectFields}
        library={library}
      />
    </div>
    </PageShell>
  );
}
