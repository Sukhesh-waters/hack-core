# F3 review package

## Commit
f56e5d5 feat(f3): custom field admin UI — create, reuse across types, archive

## Stat
 src/app/(app)/w/[ws]/fields/actions.test.ts | 165 ++++++++++++
 src/app/(app)/w/[ws]/fields/actions.ts      | 221 +++++++++++++++
 src/app/(app)/w/[ws]/fields/field-admin.tsx | 399 ++++++++++++++++++++++++++++
 src/app/(app)/w/[ws]/fields/page.tsx        |  72 +++++
 src/components/workspace-nav.tsx            |   2 +
 src/lib/nav.test.ts                         |   7 +-
 src/lib/nav.ts                              |   1 +
 7 files changed, 864 insertions(+), 3 deletions(-)

## Diff
diff --git a/src/app/(app)/w/[ws]/fields/actions.test.ts b/src/app/(app)/w/[ws]/fields/actions.test.ts
new file mode 100644
index 0000000..9018c71
--- /dev/null
+++ b/src/app/(app)/w/[ws]/fields/actions.test.ts
@@ -0,0 +1,165 @@
+import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
+
+vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
+vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
+vi.mock("@/db/queries/memberships", () => ({ requireMembership: vi.fn() }));
+vi.mock("@/db/queries/custom-fields", () => ({ archiveFieldQuery: vi.fn() }));
+vi.mock("@/db", () => ({
+  db: {
+    transaction: vi.fn(),
+    select: vi.fn(),
+    insert: vi.fn(),
+    delete: vi.fn(),
+  },
+}));
+
+const { requireUser } = await import("@/auth");
+const { requireMembership } = await import("@/db/queries/memberships");
+const { archiveFieldQuery } = await import("@/db/queries/custom-fields");
+const {
+  archiveFieldAction,
+  assignFieldAction,
+  createFieldAction,
+  unassignFieldAction,
+} = await import("./actions");
+
+const requireUserMock = requireUser as unknown as Mock;
+const requireMembershipMock = requireMembership as unknown as Mock;
+const archiveFieldQueryMock = archiveFieldQuery as unknown as Mock;
+
+function formData(entries: Record<string, string | string[]>): FormData {
+  const fd = new FormData();
+  for (const [key, value] of Object.entries(entries)) {
+    if (Array.isArray(value)) {
+      for (const v of value) fd.append(key, v);
+    } else {
+      fd.append(key, value);
+    }
+  }
+  return fd;
+}
+
+beforeEach(() => {
+  vi.clearAllMocks();
+  requireUserMock.mockResolvedValue({ id: "user_1" });
+  requireMembershipMock.mockResolvedValue({ role: "member" });
+});
+
+describe("createFieldAction — validation runs before touching auth or the db", () => {
+  it("rejects a missing workspace id without calling requireUser", async () => {
+    const result = await createFieldAction(undefined, formData({ name: "X" }));
+    expect(result?.error).toBe("Missing workspace");
+    expect(requireUserMock).not.toHaveBeenCalled();
+  });
+
+  it("rejects an empty name via customFieldDefinitionSchema", async () => {
+    const result = await createFieldAction(
+      undefined,
+      formData({
+        workspaceId: "ws_1",
+        name: "",
+        type: "short_text",
+        subjects: ["content"],
+      }),
+    );
+    expect(result?.error).toMatch(/name/i);
+    expect(requireUserMock).not.toHaveBeenCalled();
+  });
+
+  it("rejects a dropdown submitted with no options — needsOptions is enforced, not decorative", async () => {
+    const result = await createFieldAction(
+      undefined,
+      formData({
+        workspaceId: "ws_1",
+        name: "Priority",
+        type: "dropdown",
+        subjects: ["ticket"],
+      }),
+    );
+    expect(result?.error).toMatch(/at least one option/i);
+    expect(requireUserMock).not.toHaveBeenCalled();
+  });
+
+  it("rejects duplicate options", async () => {
+    const result = await createFieldAction(
+      undefined,
+      formData({
+        workspaceId: "ws_1",
+        name: "Priority",
+        type: "dropdown",
+        options: "High\nHigh",
+        subjects: ["ticket"],
+      }),
+    );
+    expect(result?.error).toMatch(/unique/i);
+  });
+
+  it("rejects zero subjects — a field attached to nothing is dead data", async () => {
+    const result = await createFieldAction(
+      undefined,
+      formData({
+        workspaceId: "ws_1",
+        name: "Notes",
+        type: "short_text",
+        subjects: [],
+      }),
+    );
+    expect(result?.error).toMatch(/pick at least one/i);
+  });
+});
+
+describe("archiveFieldAction", () => {
+  it("requires a field id", async () => {
+    const result = await archiveFieldAction(
+      undefined,
+      formData({ workspaceId: "ws_1" }),
+    );
+    expect(result?.error).toBe("Missing field");
+  });
+
+  it("reports a lost race when 0 rows come back", async () => {
+    archiveFieldQueryMock.mockResolvedValue([]);
+    const result = await archiveFieldAction(
+      undefined,
+      formData({ workspaceId: "ws_1", fieldId: "f_1" }),
+    );
+    expect(result?.error).toMatch(/already archived/i);
+  });
+
+  it("succeeds when a row comes back", async () => {
+    archiveFieldQueryMock.mockResolvedValue([{ id: "f_1" }]);
+    const result = await archiveFieldAction(
+      undefined,
+      formData({ workspaceId: "ws_1", fieldId: "f_1" }),
+    );
+    expect(result).toBeUndefined();
+  });
+});
+
+describe("assignFieldAction / unassignFieldAction — subject type is validated", () => {
+  it("assign rejects an unknown subject type before touching the db", async () => {
+    const result = await assignFieldAction(
+      undefined,
+      formData({ workspaceId: "ws_1", fieldId: "f_1", subjectType: "invoice" }),
+    );
+    expect(result?.error).toBe("Invalid subject type");
+    expect(requireUserMock).not.toHaveBeenCalled();
+  });
+
+  it("unassign rejects an unknown subject type before touching the db", async () => {
+    const result = await unassignFieldAction(
+      undefined,
+      formData({ workspaceId: "ws_1", fieldId: "f_1", subjectType: "invoice" }),
+    );
+    expect(result?.error).toBe("Invalid subject type");
+    expect(requireUserMock).not.toHaveBeenCalled();
+  });
+
+  it("assign requires a field id", async () => {
+    const result = await assignFieldAction(
+      undefined,
+      formData({ workspaceId: "ws_1", subjectType: "content" }),
+    );
+    expect(result?.error).toBe("Missing field");
+  });
+});
diff --git a/src/app/(app)/w/[ws]/fields/actions.ts b/src/app/(app)/w/[ws]/fields/actions.ts
new file mode 100644
index 0000000..cff0e8f
--- /dev/null
+++ b/src/app/(app)/w/[ws]/fields/actions.ts
@@ -0,0 +1,221 @@
+"use server";
+
+import { revalidatePath } from "next/cache";
+import { and, eq } from "drizzle-orm";
+import { requireUser } from "@/auth";
+import { db } from "@/db";
+import { customFieldAssignments, customFieldDefinitions } from "@/db/schema";
+import { requireMembership } from "@/db/queries/memberships";
+import { archiveFieldQuery } from "@/db/queries/custom-fields";
+import { actionErrorMessage } from "@/lib/action-errors";
+import {
+  CUSTOM_FIELD_SUBJECTS,
+  customFieldDefinitionSchema,
+  type CustomFieldSubject,
+} from "@/lib/custom-fields";
+
+export type FieldAdminState = { error?: string } | undefined;
+
+function isCustomFieldSubject(value: string): value is CustomFieldSubject {
+  return (CUSTOM_FIELD_SUBJECTS as readonly string[]).includes(value);
+}
+
+/** One option per line in the textarea — blank lines dropped, not an
+ *  encoding of "empty option". */
+function parseOptionsInput(raw: FormDataEntryValue | null): string[] | undefined {
+  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
+  return raw
+    .split("\n")
+    .map((o) => o.trim())
+    .filter((o) => o.length > 0);
+}
+
+function requireWorkspaceId(formData: FormData): string | { error: string } {
+  const workspaceId = formData.get("workspaceId");
+  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
+    return { error: "Missing workspace" };
+  }
+  return workspaceId;
+}
+
+/**
+ * Creates a field definition AND attaches it to every selected subject type
+ * in one transaction. A definition with no assignments is a field attached
+ * to nothing — dead data nobody can find again — so the two writes either
+ * both land or neither does.
+ */
+export async function createFieldAction(
+  _prev: FieldAdminState,
+  formData: FormData,
+): Promise<FieldAdminState> {
+  const workspaceId = requireWorkspaceId(formData);
+  if (typeof workspaceId !== "string") return workspaceId;
+
+  const parsed = customFieldDefinitionSchema.safeParse({
+    name: formData.get("name"),
+    description: formData.get("description") || null,
+    type: formData.get("type"),
+    options: parseOptionsInput(formData.get("options")),
+    required: formData.get("required") === "on",
+    subjects: formData.getAll("subjects").map(String),
+  });
+  if (!parsed.success) {
+    return { error: parsed.error.issues[0].message };
+  }
+
+  try {
+    const user = await requireUser();
+    await requireMembership(workspaceId, user.id);
+
+    await db.transaction(async (tx) => {
+      const [definition] = await tx
+        .insert(customFieldDefinitions)
+        .values({
+          workspaceId,
+          name: parsed.data.name,
+          description: parsed.data.description ?? null,
+          type: parsed.data.type,
+          options: parsed.data.options ?? null,
+          required: parsed.data.required,
+        })
+        .returning({ id: customFieldDefinitions.id });
+
+      await tx.insert(customFieldAssignments).values(
+        parsed.data.subjects.map((subjectType) => ({
+          workspaceId,
+          fieldId: definition.id,
+          subjectType,
+        })),
+      );
+    });
+  } catch (error) {
+    return { error: actionErrorMessage(error) };
+  }
+
+  revalidatePath(`/w/${workspaceId}/fields`);
+  return undefined;
+}
+
+/** Soft-retires a definition. Reports a lost race rather than a generic
+ *  failure when someone else already archived it — 0 rows back means the
+ *  guard in archiveFieldQuery (isNull(archivedAt)) didn't match. */
+export async function archiveFieldAction(
+  _prev: FieldAdminState,
+  formData: FormData,
+): Promise<FieldAdminState> {
+  const workspaceId = requireWorkspaceId(formData);
+  if (typeof workspaceId !== "string") return workspaceId;
+
+  const fieldId = formData.get("fieldId");
+  if (typeof fieldId !== "string" || fieldId.length === 0) {
+    return { error: "Missing field" };
+  }
+
+  try {
+    const user = await requireUser();
+    await requireMembership(workspaceId, user.id);
+    const rows = await archiveFieldQuery(workspaceId, fieldId);
+    if (rows.length === 0) {
+      return {
+        error: "That field was already archived (or removed) by someone else.",
+      };
+    }
+  } catch (error) {
+    return { error: actionErrorMessage(error) };
+  }
+
+  revalidatePath(`/w/${workspaceId}/fields`);
+  return undefined;
+}
+
+/**
+ * Attaches an EXISTING field definition to another subject type — the
+ * "reuse a field across types" capability. Ownership is re-checked here
+ * (fieldId + workspaceId) rather than trusted from the client: a field id
+ * alone is not proof it belongs to this workspace, and skipping this check
+ * would let one workspace attach another's field by guessing its id.
+ */
+export async function assignFieldAction(
+  _prev: FieldAdminState,
+  formData: FormData,
+): Promise<FieldAdminState> {
+  const workspaceId = requireWorkspaceId(formData);
+  if (typeof workspaceId !== "string") return workspaceId;
+
+  const fieldId = formData.get("fieldId");
+  if (typeof fieldId !== "string" || fieldId.length === 0) {
+    return { error: "Missing field" };
+  }
+  const subjectType = formData.get("subjectType");
+  if (typeof subjectType !== "string" || !isCustomFieldSubject(subjectType)) {
+    return { error: "Invalid subject type" };
+  }
+
+  try {
+    const user = await requireUser();
+    await requireMembership(workspaceId, user.id);
+
+    const [owned] = await db
+      .select({ id: customFieldDefinitions.id })
+      .from(customFieldDefinitions)
+      .where(
+        and(
+          eq(customFieldDefinitions.id, fieldId),
+          eq(customFieldDefinitions.workspaceId, workspaceId),
+        ),
+      )
+      .limit(1);
+    if (!owned) {
+      return { error: "Field not found in this workspace." };
+    }
+
+    await db
+      .insert(customFieldAssignments)
+      .values({ workspaceId, fieldId, subjectType })
+      .onConflictDoNothing();
+  } catch (error) {
+    return { error: actionErrorMessage(error) };
+  }
+
+  revalidatePath(`/w/${workspaceId}/fields`);
+  return undefined;
+}
+
+/** Detaches a field from one subject type without touching the definition
+ *  or any other subject type it's attached to. */
+export async function unassignFieldAction(
+  _prev: FieldAdminState,
+  formData: FormData,
+): Promise<FieldAdminState> {
+  const workspaceId = requireWorkspaceId(formData);
+  if (typeof workspaceId !== "string") return workspaceId;
+
+  const fieldId = formData.get("fieldId");
+  if (typeof fieldId !== "string" || fieldId.length === 0) {
+    return { error: "Missing field" };
+  }
+  const subjectType = formData.get("subjectType");
+  if (typeof subjectType !== "string" || !isCustomFieldSubject(subjectType)) {
+    return { error: "Invalid subject type" };
+  }
+
+  try {
+    const user = await requireUser();
+    await requireMembership(workspaceId, user.id);
+
+    await db
+      .delete(customFieldAssignments)
+      .where(
+        and(
+          eq(customFieldAssignments.workspaceId, workspaceId),
+          eq(customFieldAssignments.fieldId, fieldId),
+          eq(customFieldAssignments.subjectType, subjectType),
+        ),
+      );
+  } catch (error) {
+    return { error: actionErrorMessage(error) };
+  }
+
+  revalidatePath(`/w/${workspaceId}/fields`);
+  return undefined;
+}
diff --git a/src/app/(app)/w/[ws]/fields/field-admin.tsx b/src/app/(app)/w/[ws]/fields/field-admin.tsx
new file mode 100644
index 0000000..28c1fa2
--- /dev/null
+++ b/src/app/(app)/w/[ws]/fields/field-admin.tsx
@@ -0,0 +1,399 @@
+"use client";
+
+import { useMemo, useState } from "react";
+import { useFormState, useFormStatus } from "react-dom";
+import { Badge } from "@/components/ui/badge";
+import { Button } from "@/components/ui/button";
+import { GlassCard } from "@/components/glass-card";
+import { Input } from "@/components/ui/input";
+import { Textarea } from "@/components/ui/textarea";
+import {
+  CUSTOM_FIELD_SUBJECTS,
+  CUSTOM_FIELD_TYPES,
+  CUSTOM_FIELD_TYPE_META,
+  type CustomFieldDefinition,
+  type CustomFieldSubject,
+  type CustomFieldType,
+} from "@/lib/custom-fields";
+import {
+  archiveFieldAction,
+  assignFieldAction,
+  createFieldAction,
+  unassignFieldAction,
+  type FieldAdminState,
+} from "./actions";
+
+export type LibraryField = CustomFieldDefinition & {
+  /** Subject types this field is currently attached to, workspace-wide. */
+  assignedSubjects: CustomFieldSubject[];
+};
+
+const SUBJECT_LABELS: Record<CustomFieldSubject, string> = {
+  content: "Content",
+  idea: "Idea",
+  ticket: "Ticket",
+  campaign: "Campaign",
+  client: "Client",
+};
+
+const selectClasses =
+  "h-9 rounded-md border border-white/15 bg-transparent px-2 text-sm text-white/85 focus:outline-none focus:ring-1 focus:ring-brand-teal";
+
+function SubmitButton({
+  label,
+  pendingLabel,
+}: {
+  label: string;
+  pendingLabel: string;
+}) {
+  const { pending } = useFormStatus();
+  return (
+    <Button type="submit" size="sm" variant="outline" disabled={pending}>
+      {pending ? pendingLabel : label}
+    </Button>
+  );
+}
+
+function DetachControl({
+  workspaceId,
+  fieldId,
+  subjectType,
+}: {
+  workspaceId: string;
+  fieldId: string;
+  subjectType: CustomFieldSubject;
+}) {
+  const [state, formAction] = useFormState<FieldAdminState, FormData>(
+    unassignFieldAction,
+    undefined,
+  );
+  return (
+    <form action={formAction} className="flex items-center gap-2">
+      <input type="hidden" name="workspaceId" value={workspaceId} />
+      <input type="hidden" name="fieldId" value={fieldId} />
+      <input type="hidden" name="subjectType" value={subjectType} />
+      <SubmitButton label="Detach" pendingLabel="…" />
+      {state?.error ? (
+        <span className="text-xs text-red-400">{state.error}</span>
+      ) : null}
+    </form>
+  );
+}
+
+function AttachExistingField({
+  workspaceId,
+  subjectType,
+  candidates,
+}: {
+  workspaceId: string;
+  subjectType: CustomFieldSubject;
+  candidates: LibraryField[];
+}) {
+  const [state, formAction] = useFormState<FieldAdminState, FormData>(
+    assignFieldAction,
+    undefined,
+  );
+  if (candidates.length === 0) return null;
+  return (
+    <form
+      action={formAction}
+      className="mt-1 flex flex-wrap items-center gap-2"
+    >
+      <input type="hidden" name="workspaceId" value={workspaceId} />
+      <input type="hidden" name="subjectType" value={subjectType} />
+      <select
+        name="fieldId"
+        className={selectClasses}
+        defaultValue=""
+        required
+      >
+        <option value="" disabled className="bg-neutral-900">
+          Reuse an existing field…
+        </option>
+        {candidates.map((field) => (
+          <option key={field.id} value={field.id} className="bg-neutral-900">
+            {field.name} ({CUSTOM_FIELD_TYPE_META[field.type].label})
+          </option>
+        ))}
+      </select>
+      <SubmitButton label="Attach" pendingLabel="Attaching…" />
+      {state?.error ? (
+        <span className="text-xs text-red-400">{state.error}</span>
+      ) : null}
+    </form>
+  );
+}
+
+function ArchiveControl({
+  workspaceId,
+  fieldId,
+}: {
+  workspaceId: string;
+  fieldId: string;
+}) {
+  const [state, formAction] = useFormState<FieldAdminState, FormData>(
+    archiveFieldAction,
+    undefined,
+  );
+  return (
+    <form action={formAction} className="flex items-center gap-2">
+      <input type="hidden" name="workspaceId" value={workspaceId} />
+      <input type="hidden" name="fieldId" value={fieldId} />
+      <SubmitButton label="Archive" pendingLabel="…" />
+      {state?.error ? (
+        <span className="text-xs text-red-400">{state.error}</span>
+      ) : null}
+    </form>
+  );
+}
+
+function CreateFieldForm({ workspaceId }: { workspaceId: string }) {
+  const [state, formAction] = useFormState<FieldAdminState, FormData>(
+    createFieldAction,
+    undefined,
+  );
+  const [type, setType] = useState<CustomFieldType>("short_text");
+  const [subjects, setSubjects] = useState<CustomFieldSubject[]>([]);
+  const needsOptions = CUSTOM_FIELD_TYPE_META[type].needsOptions;
+
+  function toggleSubject(subject: CustomFieldSubject) {
+    setSubjects((prev) =>
+      prev.includes(subject)
+        ? prev.filter((s) => s !== subject)
+        : [...prev, subject],
+    );
+  }
+
+  return (
+    <form action={formAction} className="space-y-3">
+      <input type="hidden" name="workspaceId" value={workspaceId} />
+
+      <div className="flex flex-wrap items-center gap-2">
+        <Input
+          name="name"
+          placeholder="Field name"
+          maxLength={80}
+          required
+          className="min-w-48 flex-1"
+        />
+        <select
+          name="type"
+          className={selectClasses}
+          value={type}
+          onChange={(e) => setType(e.target.value as CustomFieldType)}
+        >
+          {CUSTOM_FIELD_TYPES.map((t) => (
+            <option key={t} value={t} className="bg-neutral-900">
+              {CUSTOM_FIELD_TYPE_META[t].label}
+            </option>
+          ))}
+        </select>
+      </div>
+
+      <Textarea
+        name="description"
+        placeholder="Description (optional)"
+        maxLength={200}
+        rows={2}
+      />
+
+      {needsOptions ? (
+        <Textarea
+          name="options"
+          placeholder="One option per line"
+          rows={3}
+          required
+        />
+      ) : null}
+
+      <label className="flex items-center gap-1.5 text-xs text-white/60">
+        <input type="checkbox" name="required" className="accent-brand-teal" />
+        Required
+      </label>
+
+      <div className="space-y-1.5">
+        <p className="text-xs text-white/60">Attach to</p>
+        <div className="flex flex-wrap gap-2">
+          {CUSTOM_FIELD_SUBJECTS.map((subject) => (
+            <label
+              key={subject}
+              className="flex items-center gap-1.5 rounded-md border border-white/15 px-2 py-1 text-xs text-white/70"
+            >
+              <input
+                type="checkbox"
+                name="subjects"
+                value={subject}
+                checked={subjects.includes(subject)}
+                onChange={() => toggleSubject(subject)}
+                className="accent-brand-teal"
+              />
+              {SUBJECT_LABELS[subject]}
+            </label>
+          ))}
+        </div>
+      </div>
+
+      <div className="flex items-center justify-end gap-2">
+        <SubmitButton label="Create field" pendingLabel="Creating…" />
+      </div>
+      {state?.error ? (
+        <p className="text-xs text-red-400">{state.error}</p>
+      ) : null}
+    </form>
+  );
+}
+
+/**
+ * F3 — the field admin screen. Left column: per subject type, the fields
+ * currently attached plus a reuse-from-library control. Right column: the
+ * type palette (reference for what each type means) and the create form.
+ * Library search sits under the create form so reuse and creation are one
+ * glance apart, not two navigations apart.
+ */
+export function FieldAdmin({
+  workspaceId,
+  subjectFields,
+  library,
+}: {
+  workspaceId: string;
+  subjectFields: Record<CustomFieldSubject, CustomFieldDefinition[]>;
+  library: LibraryField[];
+}) {
+  const [query, setQuery] = useState("");
+  const filteredLibrary = useMemo(() => {
+    const q = query.trim().toLowerCase();
+    if (!q) return library;
+    return library.filter((field) => field.name.toLowerCase().includes(q));
+  }, [library, query]);
+
+  return (
+    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
+      <div className="space-y-4">
+        {CUSTOM_FIELD_SUBJECTS.map((subject) => {
+          const attached = subjectFields[subject];
+          const attachedIds = new Set(attached.map((field) => field.id));
+          const candidates = library.filter(
+            (field) => !attachedIds.has(field.id),
+          );
+          return (
+            <GlassCard key={subject} className="space-y-3 p-4">
+              <div className="flex items-center justify-between">
+                <h2 className="font-display text-lg">
+                  {SUBJECT_LABELS[subject]}
+                </h2>
+                <span className="text-xs text-white/40">
+                  {attached.length} field{attached.length === 1 ? "" : "s"}
+                </span>
+              </div>
+
+              {attached.length === 0 ? (
+                <p className="text-sm text-white/45">
+                  No fields attached yet.
+                </p>
+              ) : (
+                <ul className="space-y-2">
+                  {attached.map((field) => (
+                    <li
+                      key={field.id}
+                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-2"
+                    >
+                      <div>
+                        <p className="text-sm text-white/85">{field.name}</p>
+                        <p className="text-xs text-white/40">
+                          {CUSTOM_FIELD_TYPE_META[field.type].label}
+                          {field.required ? " · required" : ""}
+                        </p>
+                      </div>
+                      <DetachControl
+                        workspaceId={workspaceId}
+                        fieldId={field.id}
+                        subjectType={subject}
+                      />
+                    </li>
+                  ))}
+                </ul>
+              )}
+
+              <AttachExistingField
+                workspaceId={workspaceId}
+                subjectType={subject}
+                candidates={candidates}
+              />
+            </GlassCard>
+          );
+        })}
+      </div>
+
+      <div className="space-y-4">
+        <GlassCard className="space-y-3 p-4">
+          <h2 className="font-display text-lg">Field types</h2>
+          <ul className="space-y-2">
+            {CUSTOM_FIELD_TYPES.map((t) => (
+              <li key={t} className="rounded-lg border border-white/10 p-2">
+                <p className="text-sm text-white/85">
+                  {CUSTOM_FIELD_TYPE_META[t].label}
+                </p>
+                <p className="text-xs text-white/40">
+                  {CUSTOM_FIELD_TYPE_META[t].hint}
+                </p>
+              </li>
+            ))}
+          </ul>
+        </GlassCard>
+
+        <GlassCard className="space-y-3 p-4">
+          <h2 className="font-display text-lg">New field</h2>
+          <CreateFieldForm workspaceId={workspaceId} />
+        </GlassCard>
+
+        <GlassCard className="space-y-3 p-4">
+          <div className="flex items-center justify-between">
+            <h2 className="font-display text-lg">Field library</h2>
+            <span className="text-xs text-white/40">
+              {library.length} total
+            </span>
+          </div>
+          <Input
+            placeholder="Search fields…"
+            value={query}
+            onChange={(e) => setQuery(e.target.value)}
+          />
+          {filteredLibrary.length === 0 ? (
+            <p className="text-sm text-white/45">No fields match.</p>
+          ) : (
+            <ul className="space-y-2">
+              {filteredLibrary.map((field) => (
+                <li
+                  key={field.id}
+                  className="space-y-1.5 rounded-lg border border-white/10 p-2"
+                >
+                  <div className="flex items-center justify-between gap-2">
+                    <p className="text-sm text-white/85">{field.name}</p>
+                    <ArchiveControl
+                      workspaceId={workspaceId}
+                      fieldId={field.id}
+                    />
+                  </div>
+                  <p className="text-xs text-white/40">
+                    {CUSTOM_FIELD_TYPE_META[field.type].label}
+                  </p>
+                  <div className="flex flex-wrap gap-1">
+                    {field.assignedSubjects.length === 0 ? (
+                      <Badge variant="outline">unattached</Badge>
+                    ) : (
+                      field.assignedSubjects.map((s) => (
+                        <Badge key={s} variant="secondary">
+                          {SUBJECT_LABELS[s]}
+                        </Badge>
+                      ))
+                    )}
+                  </div>
+                </li>
+              ))}
+            </ul>
+          )}
+        </GlassCard>
+      </div>
+    </div>
+  );
+}
diff --git a/src/app/(app)/w/[ws]/fields/page.tsx b/src/app/(app)/w/[ws]/fields/page.tsx
new file mode 100644
index 0000000..83c0f82
--- /dev/null
+++ b/src/app/(app)/w/[ws]/fields/page.tsx
@@ -0,0 +1,72 @@
+import { requireUser } from "@/auth";
+import { requireMembership } from "@/db/queries/memberships";
+import { allFieldsQuery, listFieldsForSubject } from "@/db/queries/custom-fields";
+import {
+  CUSTOM_FIELD_SUBJECTS,
+  type CustomFieldDefinition,
+  type CustomFieldSubject,
+  type CustomFieldType,
+} from "@/lib/custom-fields";
+import { FieldAdmin, type LibraryField } from "./field-admin";
+
+export const metadata = { title: "Fields" };
+export const dynamic = "force-dynamic";
+
+export default async function FieldsPage({
+  params,
+}: {
+  params: { ws: string };
+}) {
+  const user = await requireUser();
+  await requireMembership(params.ws, user.id);
+
+  const subjectFieldLists = await Promise.all(
+    CUSTOM_FIELD_SUBJECTS.map((subject) =>
+      listFieldsForSubject(params.ws, subject),
+    ),
+  );
+  const subjectFields = Object.fromEntries(
+    CUSTOM_FIELD_SUBJECTS.map((subject, i) => [subject, subjectFieldLists[i]]),
+  ) as Record<CustomFieldSubject, CustomFieldDefinition[]>;
+
+  // Invert subjectFields into "which subjects is this field currently
+  // attached to" — that's what lets the library tell reuse from detach.
+  const assignedSubjectsByField = new Map<string, CustomFieldSubject[]>();
+  for (const subject of CUSTOM_FIELD_SUBJECTS) {
+    for (const field of subjectFields[subject]) {
+      const list = assignedSubjectsByField.get(field.id) ?? [];
+      list.push(subject);
+      assignedSubjectsByField.set(field.id, list);
+    }
+  }
+
+  const allFieldRows = await allFieldsQuery(params.ws);
+  const library: LibraryField[] = allFieldRows.map((row) => ({
+    id: row.id,
+    name: row.name,
+    description: row.description,
+    type: row.type as CustomFieldType,
+    options: row.options ?? null,
+    required: row.required,
+    assignedSubjects: assignedSubjectsByField.get(row.id) ?? [],
+  }));
+
+  return (
+    <div>
+      <p className="label-mono text-brand-teal">Fields</p>
+      <h1 className="mt-2 font-display text-4xl">Custom field admin</h1>
+      <p className="mt-2 max-w-2xl text-sm text-white/50">
+        Define a field once, then attach it to as many subject types as make
+        sense — content, ideas, tickets, campaigns, or clients. Archiving
+        retires a field from new forms without deleting values already
+        stored under it.
+      </p>
+
+      <FieldAdmin
+        workspaceId={params.ws}
+        subjectFields={subjectFields}
+        library={library}
+      />
+    </div>
+  );
+}
diff --git a/src/components/workspace-nav.tsx b/src/components/workspace-nav.tsx
index e383499..ee395df 100644
--- a/src/components/workspace-nav.tsx
+++ b/src/components/workspace-nav.tsx
@@ -12,20 +12,21 @@ import {
   Gauge,
   Kanban,
   LayoutDashboard,
   Lightbulb,
   ListChecks,
   Megaphone,
   MessagesSquare,
   PenTool,
   Radar,
   Sliders,
+  Table2,
   TicketCheck,
   TrendingUp,
   Users,
   Inbox,
   Circle,
   Zap,
   type LucideIcon,
 } from "lucide-react";
 import { NAV_GROUPS, NAV_SECTIONS } from "@/lib/nav";
 import { cn } from "@/lib/utils";
@@ -50,20 +51,21 @@ const ICONS: Record<string, LucideIcon> = {
   studio: PenTool,
   kb: BookOpenText,
   drift: Radar,
   reports: TrendingUp,
   ads: Megaphone,
   cockpit: Gauge,
   accounts: Cable,
   rules: Sliders,
   automations: Zap,
   clients: Users,
+  fields: Table2,
 };
 
 /** Renders workspace links only when inside /w/[ws]/… routes. */
 export function WorkspaceNav() {
   const pathname = usePathname();
   const match = pathname.match(/^\/w\/([^/]+)/);
   if (!match) return null;
 
   const base = `/w/${match[1]}`;
 
diff --git a/src/lib/nav.test.ts b/src/lib/nav.test.ts
index e2bac95..2c2c08d 100644
--- a/src/lib/nav.test.ts
+++ b/src/lib/nav.test.ts
@@ -1,18 +1,18 @@
 import { describe, expect, it } from "vitest";
 import { NAV_GROUPS, NAV_SECTIONS } from "./nav";
 
 describe("nav registry", () => {
-  it("has 21 sections with unique slugs", () => {
-    expect(NAV_SECTIONS).toHaveLength(21);
+  it("has 22 sections with unique slugs", () => {
+    expect(NAV_SECTIONS).toHaveLength(22);
     const slugs = NAV_SECTIONS.map((s) => s.slug);
-    expect(new Set(slugs).size).toBe(21);
+    expect(new Set(slugs).size).toBe(22);
   });
 
   it("only uses known groups, and every group is non-empty", () => {
     for (const s of NAV_SECTIONS) {
       expect(NAV_GROUPS).toContain(s.group);
     }
     for (const g of NAV_GROUPS) {
       expect(NAV_SECTIONS.some((s) => s.group === g)).toBe(true);
     }
   });
@@ -33,15 +33,16 @@ describe("nav registry", () => {
       "brand-gene",
       "plan",
       "production",
       "tickets",
       "docs",
       "drift",
       "reports",
       "ads",
       "rules",
       "automations",
+      "fields",
     ]) {
       expect(live).toContain(slug);
     }
   });
 });
diff --git a/src/lib/nav.ts b/src/lib/nav.ts
index 30db3c0..fe590f9 100644
--- a/src/lib/nav.ts
+++ b/src/lib/nav.ts
@@ -44,11 +44,12 @@ export const NAV_SECTIONS: NavSection[] = [
   { slug: "drift", label: "Brand Drift", group: "Intelligence", status: "live" },
   // Business
   { slug: "reports", label: "Reports", group: "Business", status: "live" },
   { slug: "ads", label: "Ads Management", group: "Business", status: "live" },
   { slug: "cockpit", label: "Cockpit", group: "Business", status: "live" },
   // Infrastructure
   { slug: "accounts", label: "Connected Accounts", group: "Infrastructure", status: "live" },
   { slug: "rules", label: "Harness Rules", group: "Infrastructure", status: "live" },
   { slug: "automations", label: "Automations", group: "Infrastructure", status: "live" },
   { slug: "clients", label: "Clients", group: "Infrastructure", status: "live" },
+  { slug: "fields", label: "Fields", group: "Infrastructure", status: "live" },
 ];
