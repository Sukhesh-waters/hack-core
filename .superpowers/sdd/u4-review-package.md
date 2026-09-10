# U4 review package

63cdfe1 feat(u4): calendar row detail panel — Jira-style edit without losing your place

 src/app/(app)/w/[ws]/calendar/actions.ts       | 135 ++++++-
 src/app/(app)/w/[ws]/calendar/detail-panel.tsx | 497 +++++++++++++++++++++++++
 src/app/(app)/w/[ws]/calendar/plan-grid.tsx    |  46 ++-
 3 files changed, 674 insertions(+), 4 deletions(-)

## Diff
diff --git a/src/app/(app)/w/[ws]/calendar/actions.ts b/src/app/(app)/w/[ws]/calendar/actions.ts
index 1a496d7..d3af217 100644
--- a/src/app/(app)/w/[ws]/calendar/actions.ts
+++ b/src/app/(app)/w/[ws]/calendar/actions.ts
@@ -15,22 +15,23 @@ import {
   setPlanSlot,
   updatePlanCellQuery,
   type PlanCellValues,
 } from "@/db/queries/schedule";
 import { getBrandProfile } from "@/db/queries/brand";
 import {
   getRevisionQuery,
   markRevisionAppliedQuery,
   recordRevision,
 } from "@/db/queries/revisions";
+import { addComment, listComments } from "@/db/queries/comments";
 import { actionErrorMessage } from "@/lib/action-errors";
-import { recordActivity } from "@/lib/activity";
+import { recordActivity, listActivityForSubject } from "@/lib/activity";
 import { notify } from "@/db/queries/notifications";
 import {
   brandDnaFromProfile,
   NO_BRAND_CONTEXT_ERROR,
 } from "@/lib/ai/brand-merge";
 import { retrieveDrivers } from "@/lib/ai/retrieval";
 import { runWithAiCost } from "@/lib/ai/usage-context";
 import { resolvePlanWrite } from "@/lib/plan/apply-fields";
 import {
   isEmptySuggestion,
@@ -605,10 +606,142 @@ export async function addCalendarPostAction(
       type,
       scheduledFor,
     });
   } catch (error) {
     return { error: actionErrorMessage(error) };
   }
 
   revalidatePath(`/w/${workspaceId}/calendar`);
   return undefined;
 }
+
+// ---------------------------------------------------------------------------
+// U4 — detail panel: on-demand row detail (activity + comments)
+// ---------------------------------------------------------------------------
+
+export type RowActivityView = {
+  id: string;
+  verb: string;
+  actorId: string | null;
+  meta: Record<string, unknown> | null;
+  createdAtIso: string;
+};
+
+export type RowCommentView = {
+  id: string;
+  body: string;
+  createdAtIso: string;
+  authorName: string | null;
+  authorEmail: string;
+};
+
+export type RowDetailResult =
+  | { ok: true; activity: RowActivityView[]; comments: RowCommentView[] }
+  | { ok: false; error: string };
+
+const rowDetailSchema = z.object({
+  workspaceId: z.string().min(1),
+  contentId: z.string().min(1),
+});
+
+/**
+ * Detail-panel data, fetched on demand for the ONE row the planner opened.
+ *
+ * Activity and comments are per-row history; pulling them for all 200 rows
+ * on the grid's initial load would be an N+1 the page never needs to pay —
+ * the panel is the only consumer, and it only ever shows one row at a time.
+ */
+export async function loadRowDetailAction(
+  workspaceId: string,
+  contentId: string,
+): Promise<RowDetailResult> {
+  const parsed = rowDetailSchema.safeParse({ workspaceId, contentId });
+  if (!parsed.success) return { ok: false, error: "Missing row reference." };
+
+  try {
+    const user = await requireUser();
+    await requireMembership(workspaceId, user.id);
+
+    const row = await getContentById(workspaceId, contentId);
+    if (!row) return { ok: false, error: "That row is no longer available." };
+
+    const [activityRows, commentRows] = await Promise.all([
+      listActivityForSubject(workspaceId, "content", contentId),
+      listComments(workspaceId, contentId),
+    ]);
+
+    return {
+      ok: true,
+      activity: activityRows.map((a) => ({
+        id: a.id,
+        verb: a.verb,
+        actorId: a.actorId,
+        meta: a.meta,
+        createdAtIso: a.createdAt.toISOString(),
+      })),
+      comments: commentRows.map((c) => ({
+        id: c.id,
+        body: c.body,
+        createdAtIso: c.createdAt.toISOString(),
+        authorName: c.authorName,
+        authorEmail: c.authorEmail,
+      })),
+    };
+  } catch (error) {
+    return { ok: false, error: actionErrorMessage(error) };
+  }
+}
+
+const addRowCommentSchema = z.object({
+  workspaceId: z.string().min(1),
+  contentId: z.string().min(1),
+  body: z.string().trim().min(1, "Write something first").max(1000),
+});
+
+export type AddRowCommentResult =
+  | { ok: true; comments: RowCommentView[] }
+  | { ok: false; error: string };
+
+/**
+ * Post a comment from the detail panel.
+ *
+ * Returns the refreshed thread rather than just the one new row: the
+ * comments table has no client-visible identity for "my just-posted row"
+ * beyond what listComments already resolves (author join, ordering), so
+ * re-reading the small (200-row-capped) thread is simpler and correct than
+ * hand-assembling a CommentView on the client.
+ */
+export async function addPlanRowCommentAction(input: {
+  workspaceId: string;
+  contentId: string;
+  body: string;
+}): Promise<AddRowCommentResult> {
+  const parsed = addRowCommentSchema.safeParse(input);
+  if (!parsed.success) {
+    return { ok: false, error: parsed.error.issues[0].message };
+  }
+  const { workspaceId, contentId, body } = parsed.data;
+
+  try {
+    const user = await requireUser();
+    await requireMembership(workspaceId, user.id);
+
+    const row = await getContentById(workspaceId, contentId);
+    if (!row) return { ok: false, error: "That row is no longer available." };
+
+    await addComment({ workspaceId, contentId, authorId: user.id, body });
+    const commentRows = await listComments(workspaceId, contentId);
+
+    return {
+      ok: true,
+      comments: commentRows.map((c) => ({
+        id: c.id,
+        body: c.body,
+        createdAtIso: c.createdAt.toISOString(),
+        authorName: c.authorName,
+        authorEmail: c.authorEmail,
+      })),
+    };
+  } catch (error) {
+    return { ok: false, error: actionErrorMessage(error) };
+  }
+}
diff --git a/src/app/(app)/w/[ws]/calendar/detail-panel.tsx b/src/app/(app)/w/[ws]/calendar/detail-panel.tsx
new file mode 100644
index 0000000..dda88d7
--- /dev/null
+++ b/src/app/(app)/w/[ws]/calendar/detail-panel.tsx
@@ -0,0 +1,497 @@
+"use client";
+
+import { useEffect, useRef, useState } from "react";
+import Link from "next/link";
+import { Badge } from "@/components/ui/badge";
+import { cn } from "@/lib/utils";
+import { CONTENT_TYPE_COLORS, type ContentType } from "@/lib/colors";
+import { contentType, isVideoContentType } from "@/db/schema";
+import type { PlanCellField } from "@/lib/plan-cell";
+import {
+  labelize,
+  toLocalInput,
+  type MemberOption,
+  type PlanRowView,
+} from "./plan-grid";
+import {
+  addPlanRowCommentAction,
+  loadRowDetailAction,
+  type RowActivityView,
+  type RowCommentView,
+} from "./actions";
+
+const fieldClass =
+  "w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-teal/60 focus:bg-white/10";
+
+/** Renders one activity row into a short human sentence. Unknown verbs fall
+ *  back to a labelized verb rather than dropping the entry silently — a
+ *  history line the UI can't fully explain is still evidence something
+ *  happened. */
+function describeActivity(entry: RowActivityView, members: MemberOption[]) {
+  const who = (id: string | null) =>
+    id ? (members.find((m) => m.id === id)?.label ?? "Someone") : "System";
+  const meta = entry.meta ?? {};
+  switch (entry.verb) {
+    case "assigned": {
+      const to = meta.to;
+      return `Assigned to ${typeof to === "string" ? who(to) : "no one"}`;
+    }
+    case "due_set": {
+      const to = meta.to;
+      if (typeof to !== "string") return "Due date cleared";
+      const d = new Date(to);
+      return Number.isNaN(d.getTime())
+        ? "Due date updated"
+        : `Due date set to ${d.toLocaleDateString()}`;
+    }
+    case "revision_applied": {
+      const fields = Array.isArray(meta.fields) ? (meta.fields as string[]) : [];
+      return fields.length
+        ? `Applied suggestion: ${fields.map(labelize).join(", ")}`
+        : "Applied a suggestion";
+    }
+    default:
+      return labelize(entry.verb);
+  }
+}
+
+function PanelField({
+  label,
+  children,
+}: {
+  label: string;
+  children: React.ReactNode;
+}) {
+  return (
+    <div>
+      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
+      <div className="mt-1">{children}</div>
+    </div>
+  );
+}
+
+function PanelText({
+  label,
+  value,
+  wide,
+  textarea,
+  onCommit,
+}: {
+  label: string;
+  value: string | null;
+  wide?: boolean;
+  textarea?: boolean;
+  onCommit: (value: string | null) => void;
+}) {
+  const commonProps = {
+    "aria-label": label,
+    placeholder: "—",
+    defaultValue: value ?? "",
+    className: cn(fieldClass, wide ? "min-h-20" : undefined),
+    onKeyDown: (
+      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
+    ) => {
+      if (e.key === "Escape") {
+        e.currentTarget.value = value ?? "";
+        e.currentTarget.blur();
+      }
+      if (e.key === "Enter" && !textarea) e.currentTarget.blur();
+    },
+    onBlur: (
+      e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
+    ) => {
+      const next = e.target.value.trim();
+      const normalized = next === "" ? null : next;
+      if (normalized === value) return;
+      onCommit(normalized);
+    },
+  };
+  return textarea ? (
+    <textarea rows={3} {...commonProps} />
+  ) : (
+    <input type="text" {...commonProps} />
+  );
+}
+
+export function DetailPanel({
+  workspaceId,
+  row,
+  members,
+  suppressClose,
+  onClose,
+  onOpenSuggestions,
+  onCommit,
+}: {
+  workspaceId: string;
+  row: PlanRowView;
+  members: MemberOption[];
+  /** True while a layered dialog (the RevisionDrawer) is open on top of this
+   *  panel — its own Escape/outside-click close is suppressed so the two
+   *  don't fight over the same key press or click. */
+  suppressClose: boolean;
+  onClose: () => void;
+  onOpenSuggestions: () => void;
+  onCommit: (
+    field: PlanCellField,
+    value: string | number | null,
+    patch: Partial<PlanRowView>,
+  ) => void;
+}) {
+  const panelRef = useRef<HTMLDivElement>(null);
+  const [detail, setDetail] = useState<{
+    activity: RowActivityView[];
+    comments: RowCommentView[];
+  } | null>(null);
+  const [detailError, setDetailError] = useState<string | null>(null);
+  const [commentBody, setCommentBody] = useState("");
+  const [postingComment, setPostingComment] = useState(false);
+  const [commentError, setCommentError] = useState<string | null>(null);
+
+  useEffect(() => {
+    let cancelled = false;
+    setDetail(null);
+    setDetailError(null);
+    loadRowDetailAction(workspaceId, row.id).then((result) => {
+      if (cancelled) return;
+      if (!result.ok) {
+        setDetailError(result.error);
+        return;
+      }
+      setDetail({ activity: result.activity, comments: result.comments });
+    });
+    return () => {
+      cancelled = true;
+    };
+  }, [workspaceId, row.id]);
+
+  useEffect(() => {
+    if (suppressClose) return;
+    function handleKey(e: KeyboardEvent) {
+      if (e.key === "Escape") onClose();
+    }
+    function handlePointerDown(e: MouseEvent) {
+      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
+        onClose();
+      }
+    }
+    document.addEventListener("keydown", handleKey);
+    document.addEventListener("mousedown", handlePointerDown);
+    return () => {
+      document.removeEventListener("keydown", handleKey);
+      document.removeEventListener("mousedown", handlePointerDown);
+    };
+  }, [onClose, suppressClose]);
+
+  async function submitComment() {
+    const body = commentBody.trim();
+    if (!body) return;
+    setPostingComment(true);
+    setCommentError(null);
+    try {
+      const result = await addPlanRowCommentAction({
+        workspaceId,
+        contentId: row.id,
+        body,
+      });
+      if (!result.ok) {
+        setCommentError(result.error);
+        return;
+      }
+      setDetail((cur) => ({
+        activity: cur?.activity ?? [],
+        comments: result.comments,
+      }));
+      setCommentBody("");
+    } finally {
+      setPostingComment(false);
+    }
+  }
+
+  return (
+    <div
+      ref={panelRef}
+      role="dialog"
+      aria-label={`Details for ${row.title}`}
+      className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-white/10 bg-slate-950 p-5 shadow-2xl"
+    >
+      <div className="flex items-start justify-between gap-4">
+        <div className="min-w-0 flex-1">
+          <PanelText
+            label="Title"
+            value={row.title}
+            wide
+            onCommit={(v) => onCommit("title", v ?? "", { title: v ?? "" })}
+          />
+          <p className="mt-1.5 text-sm text-white/50">{row.clientName}</p>
+          <Link
+            href={`/w/${workspaceId}/studio/${row.id}`}
+            className="mt-1 inline-block text-xs text-brand-teal underline-offset-2 hover:underline"
+          >
+            Open in Studio →
+          </Link>
+        </div>
+        <button
+          type="button"
+          onClick={onClose}
+          className="rounded-md border border-white/15 px-2.5 py-1 text-sm text-white/60 hover:text-white"
+        >
+          Close
+        </button>
+      </div>
+
+      {/* Workflow state — read-only. Moves through approvals and the stage
+          transition graph, never a spreadsheet-style edit. */}
+      <div className="mt-4 flex flex-wrap gap-1.5">
+        <Badge variant="outline" className="border-white/15 text-xs text-white/60">
+          {labelize(row.status)}
+        </Badge>
+        <Badge variant="outline" className="border-white/15 text-xs text-white/60">
+          {labelize(row.complianceStatus)}
+        </Badge>
+        <Badge variant="outline" className="border-white/15 text-xs text-white/60">
+          {row.productionStage ? labelize(row.productionStage) : "No stage"}
+        </Badge>
+      </div>
+
+      <div className="mt-5 space-y-4">
+        <PanelField label="Type">
+          <span className="flex items-center gap-1.5">
+            <span
+              aria-hidden
+              className={cn(
+                "size-1.5 shrink-0 rounded-full",
+                CONTENT_TYPE_COLORS[row.type].dot,
+              )}
+            />
+            <select
+              aria-label="Content type"
+              className={fieldClass}
+              value={row.type}
+              onChange={(e) => {
+                const next = e.target.value as ContentType;
+                onCommit("type", next, {
+                  type: next,
+                  durationSec: isVideoContentType(next)
+                    ? row.durationSec
+                    : null,
+                });
+              }}
+            >
+              {contentType.enumValues.map((t) => (
+                <option key={t} value={t} className="bg-slate-900">
+                  {labelize(t)}
+                </option>
+              ))}
+            </select>
+          </span>
+        </PanelField>
+
+        {isVideoContentType(row.type) ? (
+          <PanelField label="Duration (seconds)">
+            <input
+              type="number"
+              min={1}
+              aria-label="Duration in seconds"
+              placeholder="sec"
+              className={fieldClass}
+              defaultValue={row.durationSec ?? ""}
+              onKeyDown={(e) => {
+                if (e.key === "Escape") {
+                  e.currentTarget.value = String(row.durationSec ?? "");
+                  e.currentTarget.blur();
+                }
+                if (e.key === "Enter") e.currentTarget.blur();
+              }}
+              onBlur={(e) => {
+                const raw = e.target.value.trim();
+                const next = raw === "" ? null : Number(raw);
+                if (next === row.durationSec) return;
+                onCommit("durationSec", next, { durationSec: next });
+              }}
+            />
+          </PanelField>
+        ) : null}
+
+        <PanelField label="Pillar">
+          <PanelText
+            label="Pillar"
+            value={row.pillar}
+            onCommit={(v) => onCommit("pillar", v, { pillar: v })}
+          />
+        </PanelField>
+
+        <PanelField label="Strategy note">
+          <PanelText
+            label="Strategy note"
+            value={row.strategyNote}
+            wide
+            textarea
+            onCommit={(v) => onCommit("strategyNote", v, { strategyNote: v })}
+          />
+        </PanelField>
+
+        <PanelField label="Assignee">
+          <select
+            aria-label="Assignee"
+            className={fieldClass}
+            value={row.assigneeId ?? ""}
+            onChange={(e) => {
+              const next = e.target.value || null;
+              onCommit("assigneeId", next, { assigneeId: next });
+            }}
+          >
+            <option value="" className="bg-slate-900">
+              Unassigned
+            </option>
+            {members.map((m) => (
+              <option key={m.id} value={m.id} className="bg-slate-900">
+                {m.label}
+              </option>
+            ))}
+          </select>
+        </PanelField>
+
+        <PanelField label="Due date">
+          <input
+            type="date"
+            aria-label="Due date"
+            className={fieldClass}
+            defaultValue={toLocalInput(row.dueAtIso, false)}
+            onKeyDown={(e) => {
+              if (e.key === "Escape") {
+                e.currentTarget.value = toLocalInput(row.dueAtIso, false);
+                e.currentTarget.blur();
+              }
+              if (e.key === "Enter") e.currentTarget.blur();
+            }}
+            onBlur={(e) => {
+              const raw = e.target.value;
+              const iso = raw ? new Date(raw).toISOString() : null;
+              if (iso === row.dueAtIso) return;
+              onCommit("dueAt", iso, { dueAtIso: iso });
+            }}
+          />
+        </PanelField>
+
+        <PanelField label="Scheduled for">
+          <input
+            type="datetime-local"
+            aria-label="Scheduled for"
+            className={fieldClass}
+            defaultValue={toLocalInput(row.scheduledForIso, true)}
+            onKeyDown={(e) => {
+              if (e.key === "Escape") {
+                e.currentTarget.value = toLocalInput(row.scheduledForIso, true);
+                e.currentTarget.blur();
+              }
+              if (e.key === "Enter") e.currentTarget.blur();
+            }}
+            onBlur={(e) => {
+              const raw = e.target.value;
+              const iso = raw ? new Date(raw).toISOString() : null;
+              if (iso === row.scheduledForIso) return;
+              onCommit("scheduledFor", iso, { scheduledForIso: iso });
+            }}
+          />
+        </PanelField>
+      </div>
+
+      <div className="mt-5 border-t border-white/10 pt-4">
+        {row.pendingSuggestions > 0 ? (
+          <button
+            type="button"
+            onClick={onOpenSuggestions}
+            className="text-sm text-brand-teal underline-offset-2 hover:underline"
+          >
+            {row.pendingSuggestions} pending suggestion
+            {row.pendingSuggestions === 1 ? "" : "s"} — review
+          </button>
+        ) : (
+          <p className="text-sm text-white/40">No pending suggestions.</p>
+        )}
+      </div>
+
+      <div className="mt-5 border-t border-white/10 pt-4">
+        <p className="text-xs uppercase tracking-wide text-white/40">
+          Activity
+        </p>
+        {detailError ? (
+          <p role="alert" className="mt-2 text-sm text-red-300">
+            {detailError}
+          </p>
+        ) : null}
+        {!detail && !detailError ? (
+          <p className="mt-2 text-sm text-white/40">Loading…</p>
+        ) : null}
+        {detail && detail.activity.length === 0 ? (
+          <p className="mt-2 text-sm text-white/40">No activity yet.</p>
+        ) : null}
+        {detail && detail.activity.length > 0 ? (
+          <ul className="mt-2 space-y-2">
+            {detail.activity.map((entry) => (
+              <li key={entry.id} className="text-sm text-white/70">
+                <span>{describeActivity(entry, members)}</span>
+                <span className="ml-2 text-xs text-white/30">
+                  {new Date(entry.createdAtIso).toLocaleString()}
+                </span>
+              </li>
+            ))}
+          </ul>
+        ) : null}
+      </div>
+
+      <div className="mt-5 border-t border-white/10 pt-4 pb-2">
+        <p className="text-xs uppercase tracking-wide text-white/40">
+          Comments
+        </p>
+        {detail && detail.comments.length > 0 ? (
+          <ul className="mt-2 space-y-3">
+            {detail.comments.map((comment) => (
+              <li key={comment.id} className="rounded-md border border-white/10 p-2.5">
+                <p className="text-xs text-white/40">
+                  {comment.authorName ?? comment.authorEmail}
+                  <span className="ml-2 text-white/25">
+                    {new Date(comment.createdAtIso).toLocaleString()}
+                  </span>
+                </p>
+                <p className="mt-1 whitespace-pre-wrap text-sm text-white/80">
+                  {comment.body}
+                </p>
+              </li>
+            ))}
+          </ul>
+        ) : detail ? (
+          <p className="mt-2 text-sm text-white/40">No comments yet.</p>
+        ) : null}
+
+        {commentError ? (
+          <p role="alert" className="mt-2 text-sm text-red-300">
+            {commentError}
+          </p>
+        ) : null}
+
+        <div className="mt-3 space-y-2">
+          <textarea
+            rows={2}
+            aria-label="Add a comment"
+            placeholder="Message the team…"
+            value={commentBody}
+            onChange={(e) => setCommentBody(e.target.value)}
+            maxLength={1000}
+            className={fieldClass}
+          />
+          <div className="flex justify-end">
+            <button
+              type="button"
+              disabled={postingComment || commentBody.trim() === ""}
+              onClick={submitComment}
+              className="rounded-md border border-brand-teal/50 bg-brand-teal/10 px-3 py-1.5 text-sm text-white disabled:opacity-40"
+            >
+              {postingComment ? "Posting…" : "Comment"}
+            </button>
+          </div>
+        </div>
+      </div>
+    </div>
+  );
+}
diff --git a/src/app/(app)/w/[ws]/calendar/plan-grid.tsx b/src/app/(app)/w/[ws]/calendar/plan-grid.tsx
index 7bf0602..70b9fff 100644
--- a/src/app/(app)/w/[ws]/calendar/plan-grid.tsx
+++ b/src/app/(app)/w/[ws]/calendar/plan-grid.tsx
@@ -2,20 +2,21 @@
 
 import { Fragment, useState, useTransition } from "react";
 import { Badge } from "@/components/ui/badge";
 import { cn } from "@/lib/utils";
 import { CONTENT_TYPE_COLORS, type ContentType } from "@/lib/colors";
 import { isVideoContentType } from "@/db/schema";
 import type { PlanCellField } from "@/lib/plan-cell";
 import { groupRows, type PlanGrouping, type PlanScope } from "@/lib/plan-view";
 import { askPlanRowAction, updatePlanCellAction } from "./actions";
 import { RevisionDrawer, type RevisionView } from "./revision-drawer";
+import { DetailPanel } from "./detail-panel";
 
 export type PlanRowView = {
   id: string;
   scheduledForIso: string | null;
   clientName: string;
   type: ContentType;
   durationSec: number | null;
   pillar: string | null;
   strategyNote: string | null;
   title: string;
@@ -44,21 +45,21 @@ const CONTENT_TYPES: ContentType[] = [
   "story",
   "carousel",
   "talking_head",
   "motion_graphic",
   "static",
 ];
 
 const cellClass =
   "w-full rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm text-white/80 outline-none hover:border-white/15 focus:border-brand-teal/60 focus:bg-white/5";
 
-function labelize(value: string) {
+export function labelize(value: string) {
   return value.replace(/_/g, " ");
 }
 
 /**
  * The empty state should say why the grid is empty in terms of the active
  * scope, not a one-size-fits-all message — "no rows" reads very differently
  * for "nothing exists yet" versus "nothing is assigned to you yet". Built
  * from `label` (from resolvePlanView) rather than duplicating scope logic
  * here, so the wording tracks whatever U2 resolves the scope to.
  */
@@ -71,21 +72,21 @@ function emptyStateCopy(scope: PlanScope, label: string): string {
     case "client":
     case "person":
       return `Nothing in ${label} this month.`;
     case "all":
     default:
       return "No content this month. Add a card from Production, or accept an idea in Plan & Validate.";
   }
 }
 
 /** datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not an ISO-Z. */
-function toLocalInput(iso: string | null, withTime: boolean) {
+export function toLocalInput(iso: string | null, withTime: boolean) {
   if (!iso) return "";
   const d = new Date(iso);
   if (Number.isNaN(d.getTime())) return "";
   const pad = (n: number) => String(n).padStart(2, "0");
   const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
   return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
 }
 
 export function PlanGrid({
   workspaceId,
@@ -106,20 +107,23 @@ export function PlanGrid({
   grouping: PlanGrouping;
   /** Human-readable scope label from resolvePlanView, for the empty state. */
   label: string;
 }) {
   const [rows, setRows] = useState(initialRows);
   const [error, setError] = useState<string | null>(null);
   const [notice, setNotice] = useState<string | null>(null);
   const [showAll, setShowAll] = useState(false);
   const [asking, setAsking] = useState<string | null>(null);
   const [openRow, setOpenRow] = useState<string | null>(null);
+  // Which row's detail panel is open (Jira-style: a persistent side panel,
+  // not a route — editing there must never lose your place in the list).
+  const [detailRowId, setDetailRowId] = useState<string | null>(null);
   const [pending, setPending] = useState(revisions);
   const [saving, startTransition] = useTransition();
 
   /**
    * Asking for a suggestion never changes the row. The badge count goes up
    * and that is all — the proposed values stay in content_revisions until a
    * human accepts them field by field.
    */
   async function ask(rowId: string) {
     setAsking(rowId);
@@ -217,20 +221,21 @@ export function PlanGrid({
         <p className="mt-2 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-3 py-2 text-sm text-brand-teal">
           {notice}
         </p>
       ) : null}
 
       <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
         <table className="w-full min-w-[1100px] border-collapse text-left">
           <thead>
             <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-white/40">
               {[
+                "",
                 "Date",
                 "Client",
                 "Type",
                 "Duration",
                 "Pillar",
                 "Strategy",
                 "Title",
                 "Status",
                 "Stage",
                 "Assignee",
@@ -242,32 +247,42 @@ export function PlanGrid({
                 </th>
               ))}
             </tr>
           </thead>
           <tbody>
             {groups.map((group) => (
               <Fragment key={group.key || "__ungrouped__"}>
                 {grouping !== "none" ? (
                   <tr className="border-b border-white/10 bg-white/[0.03]">
                     <td
-                      colSpan={12}
+                      colSpan={13}
                       className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-white/50"
                     >
                       {group.key} ({group.rows.length})
                     </td>
                   </tr>
                 ) : null}
                 {group.rows.map((row) => (
               <tr
                 key={row.id}
                 className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
               >
+                <td className="px-1 py-1">
+                  <button
+                    type="button"
+                    aria-label={`Open ${row.title}`}
+                    onClick={() => setDetailRowId(row.id)}
+                    className="rounded-sm px-1 py-0.5 text-white/25 hover:bg-white/10 hover:text-white"
+                  >
+                    ›
+                  </button>
+                </td>
                 <td className="px-2 py-1">
                   <input
                     type="datetime-local"
                     aria-label="Scheduled for"
                     className={cn(cellClass, "min-w-44")}
                     defaultValue={toLocalInput(row.scheduledForIso, true)}
                     onKeyDown={(e) => {
                       if (e.key === "Escape") {
                         e.currentTarget.value = toLocalInput(
                           row.scheduledForIso,
@@ -512,20 +527,45 @@ export function PlanGrid({
                         r.pendingSuggestions - 1,
                       ),
                     }
                   : r,
               ),
             );
           }}
         />
       ) : null}
 
+      {detailRowId
+        ? (() => {
+            const detailRow = rows.find((r) => r.id === detailRowId);
+            if (!detailRow) return null;
+            return (
+              <DetailPanel
+                key={detailRow.id}
+                workspaceId={workspaceId}
+                row={detailRow}
+                members={members}
+                // Suppresses the panel's own Escape/outside-click close while
+                // the RevisionDrawer it opened is layered on top of it — an
+                // Escape meant for the drawer shouldn't also dismiss the
+                // panel underneath it.
+                suppressClose={openRow === detailRow.id}
+                onClose={() => setDetailRowId(null)}
+                onOpenSuggestions={() => setOpenRow(detailRow.id)}
+                onCommit={(field, value, patch) =>
+                  commit(detailRow.id, field, value, patch)
+                }
+              />
+            );
+          })()
+        : null}
+
       {!showAll && rows.length > VISIBLE_CAP ? (
         <button
           type="button"
           onClick={() => setShowAll(true)}
           className="mt-3 rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/60 hover:text-white"
         >
           Show all {rows.length} rows
         </button>
       ) : null}
     </div>
