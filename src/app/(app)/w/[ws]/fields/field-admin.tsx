"use client";

import { useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CUSTOM_FIELD_SUBJECTS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_META,
  type CustomFieldDefinition,
  type CustomFieldSubject,
  type CustomFieldType,
} from "@/lib/custom-fields";
import {
  archiveFieldAction,
  assignFieldAction,
  createFieldAction,
  unassignFieldAction,
  type FieldAdminState,
} from "./actions";

export type LibraryField = CustomFieldDefinition & {
  /** Subject types this field is currently attached to, workspace-wide. */
  assignedSubjects: CustomFieldSubject[];
};

const SUBJECT_LABELS: Record<CustomFieldSubject, string> = {
  content: "Content",
  idea: "Idea",
  ticket: "Ticket",
  campaign: "Campaign",
  client: "Client",
};

const selectClasses =
  "h-9 rounded-md border border-border bg-transparent px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal";

function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function DetachControl({
  workspaceId,
  fieldId,
  subjectType,
}: {
  workspaceId: string;
  fieldId: string;
  subjectType: CustomFieldSubject;
}) {
  const [state, formAction] = useActionState<FieldAdminState, FormData>(
    unassignFieldAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="fieldId" value={fieldId} />
      <input type="hidden" name="subjectType" value={subjectType} />
      <SubmitButton label="Detach" pendingLabel="…" />
      {state?.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}

function AttachExistingField({
  workspaceId,
  subjectType,
  candidates,
}: {
  workspaceId: string;
  subjectType: CustomFieldSubject;
  candidates: LibraryField[];
}) {
  const [state, formAction] = useActionState<FieldAdminState, FormData>(
    assignFieldAction,
    undefined,
  );
  if (candidates.length === 0) return null;
  return (
    <form
      action={formAction}
      className="mt-1 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="subjectType" value={subjectType} />
      <select
        name="fieldId"
        className={selectClasses}
        defaultValue=""
        required
      >
        <option value="" disabled className="bg-neutral-900">
          Reuse an existing field…
        </option>
        {candidates.map((field) => (
          <option key={field.id} value={field.id} className="bg-neutral-900">
            {field.name} ({CUSTOM_FIELD_TYPE_META[field.type].label})
          </option>
        ))}
      </select>
      <SubmitButton label="Attach" pendingLabel="Attaching…" />
      {state?.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}

function ArchiveControl({
  workspaceId,
  fieldId,
}: {
  workspaceId: string;
  fieldId: string;
}) {
  const [state, formAction] = useActionState<FieldAdminState, FormData>(
    archiveFieldAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="fieldId" value={fieldId} />
      <SubmitButton label="Archive" pendingLabel="…" />
      {state?.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}

function CreateFieldForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useActionState<FieldAdminState, FormData>(
    createFieldAction,
    undefined,
  );
  const [type, setType] = useState<CustomFieldType>("short_text");
  const [subjects, setSubjects] = useState<CustomFieldSubject[]>([]);
  const needsOptions = CUSTOM_FIELD_TYPE_META[type].needsOptions;

  function toggleSubject(subject: CustomFieldSubject) {
    setSubjects((prev) =>
      prev.includes(subject)
        ? prev.filter((s) => s !== subject)
        : [...prev, subject],
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="name"
          placeholder="Field name"
          maxLength={80}
          required
          className="min-w-48 flex-1"
        />
        <select
          name="type"
          className={selectClasses}
          value={type}
          onChange={(e) => setType(e.target.value as CustomFieldType)}
        >
          {CUSTOM_FIELD_TYPES.map((t) => (
            <option key={t} value={t} className="bg-neutral-900">
              {CUSTOM_FIELD_TYPE_META[t].label}
            </option>
          ))}
        </select>
      </div>

      <Textarea
        name="description"
        placeholder="Description (optional)"
        maxLength={200}
        rows={2}
      />

      {needsOptions ? (
        <Textarea
          name="options"
          placeholder="One option per line"
          rows={3}
          required
        />
      ) : null}

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" name="required" className="accent-brand-teal" />
        Required
      </label>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Attach to</p>
        <div className="flex flex-wrap gap-2">
          {CUSTOM_FIELD_SUBJECTS.map((subject) => (
            <label
              key={subject}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
            >
              <input
                type="checkbox"
                name="subjects"
                value={subject}
                checked={subjects.includes(subject)}
                onChange={() => toggleSubject(subject)}
                className="accent-brand-teal"
              />
              {SUBJECT_LABELS[subject]}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <SubmitButton label="Create field" pendingLabel="Creating…" />
      </div>
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}

/**
 * F3 — the field admin screen. Left column: per subject type, the fields
 * currently attached plus a reuse-from-library control. Right column: the
 * type palette (reference for what each type means) and the create form.
 * Library search sits under the create form so reuse and creation are one
 * glance apart, not two navigations apart.
 */
export function FieldAdmin({
  workspaceId,
  subjectFields,
  library,
}: {
  workspaceId: string;
  subjectFields: Record<CustomFieldSubject, CustomFieldDefinition[]>;
  library: LibraryField[];
}) {
  const [query, setQuery] = useState("");
  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library;
    return library.filter((field) => field.name.toLowerCase().includes(q));
  }, [library, query]);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {CUSTOM_FIELD_SUBJECTS.map((subject) => {
          const attached = subjectFields[subject];
          const attachedIds = new Set(attached.map((field) => field.id));
          const candidates = library.filter(
            (field) => !attachedIds.has(field.id),
          );
          return (
            <GlassCard key={subject} className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg">
                  {SUBJECT_LABELS[subject]}
                </h2>
                <span className="text-xs text-muted-foreground/70">
                  {attached.length} field{attached.length === 1 ? "" : "s"}
                </span>
              </div>

              {attached.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">
                  No fields attached yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {attached.map((field) => (
                    <li
                      key={field.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2"
                    >
                      <div>
                        <p className="text-sm text-foreground">{field.name}</p>
                        <p className="text-xs text-muted-foreground/70">
                          {CUSTOM_FIELD_TYPE_META[field.type].label}
                          {field.required ? " · required" : ""}
                        </p>
                      </div>
                      <DetachControl
                        workspaceId={workspaceId}
                        fieldId={field.id}
                        subjectType={subject}
                      />
                    </li>
                  ))}
                </ul>
              )}

              <AttachExistingField
                workspaceId={workspaceId}
                subjectType={subject}
                candidates={candidates}
              />
            </GlassCard>
          );
        })}
      </div>

      <div className="space-y-4">
        <GlassCard className="space-y-3 p-4">
          <h2 className="font-display text-lg">Field types</h2>
          <ul className="space-y-2">
            {CUSTOM_FIELD_TYPES.map((t) => (
              <li key={t} className="rounded-lg border border-border p-2">
                <p className="text-sm text-foreground">
                  {CUSTOM_FIELD_TYPE_META[t].label}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {CUSTOM_FIELD_TYPE_META[t].hint}
                </p>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="space-y-3 p-4">
          <h2 className="font-display text-lg">New field</h2>
          <CreateFieldForm workspaceId={workspaceId} />
        </GlassCard>

        <GlassCard className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg">Field library</h2>
            <span className="text-xs text-muted-foreground/70">
              {library.length} total
            </span>
          </div>
          <Input
            placeholder="Search fields…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filteredLibrary.length === 0 ? (
            <p className="text-sm text-muted-foreground/70">No fields match.</p>
          ) : (
            <ul className="space-y-2">
              {filteredLibrary.map((field) => (
                <li
                  key={field.id}
                  className="space-y-1.5 rounded-lg border border-border p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-foreground">{field.name}</p>
                    <ArchiveControl
                      workspaceId={workspaceId}
                      fieldId={field.id}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    {CUSTOM_FIELD_TYPE_META[field.type].label}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {field.assignedSubjects.length === 0 ? (
                      <Badge variant="outline">unattached</Badge>
                    ) : (
                      field.assignedSubjects.map((s) => (
                        <Badge key={s} variant="secondary">
                          {SUBJECT_LABELS[s]}
                        </Badge>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
