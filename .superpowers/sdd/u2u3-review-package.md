# U2/U3 review package

## Commit
8905dc1 feat(u2/u3): plan grid scope switcher and grouped sections

## Stat
 src/app/(app)/w/[ws]/calendar/page.tsx          |  83 ++++++++---
 src/app/(app)/w/[ws]/calendar/plan-grid.tsx     |  56 ++++++-
 src/app/(app)/w/[ws]/calendar/view-controls.tsx | 189 ++++++++++++++++++++++++
 3 files changed, 307 insertions(+), 21 deletions(-)

## Diff
diff --git a/src/app/(app)/w/[ws]/calendar/page.tsx b/src/app/(app)/w/[ws]/calendar/page.tsx
index 5cfe900..99932c4 100644
--- a/src/app/(app)/w/[ws]/calendar/page.tsx
+++ b/src/app/(app)/w/[ws]/calendar/page.tsx
@@ -1,61 +1,92 @@
 import Link from "next/link";
+import { requireUser } from "@/auth";
 import { listClients } from "@/db/queries/clients";
 import { listWorkspaceMembers } from "@/db/queries/memberships";
 import {
   pendingRevisionCounts,
   pendingRevisionsForContents,
 } from "@/db/queries/revisions";
 import { listPlanGrid, listScheduledSlots } from "@/db/queries/schedule";
 import {
   groupByDay,
   isOverdueSlot,
   monthGrid,
   monthGridRange,
   publishChecklist,
 } from "@/lib/calendar";
 import type { ContentType } from "@/lib/colors";
+import { resolvePlanView } from "@/lib/plan-view";
 import { CalendarBoard, type CalendarDayView } from "./calendar-board";
 import { PlanGrid } from "./plan-grid";
+import { ViewControls } from "./view-controls";
 
 export const metadata = { title: "Calendar" };
 export const dynamic = "force-dynamic";
 
 export default async function CalendarPage({
   params,
   searchParams,
 }: {
   params: { ws: string };
-  searchParams: { m?: string; view?: string };
+  searchParams: {
+    m?: string;
+    view?: string;
+    scope?: string;
+    clientId?: string;
+    userId?: string;
+    group?: string;
+  };
 }) {
   const now = new Date();
   const [year, month] = (searchParams.m ?? "")
     .match(/^(\d{4})-(\d{2})$/)
     ?.slice(1)
     .map(Number) ?? [now.getFullYear(), now.getMonth() + 1];
   const monthIndex = month - 1;
   const view = searchParams.view === "grid" ? "grid" : "month";
 
   const range = monthGridRange(year, monthIndex);
   const [slots, clients] = await Promise.all([
     listScheduledSlots(params.ws, range),
     listClients(params.ws),
   ]);
 
   // Only the grid view pays for these — the month view doesn't render them.
-  const [gridRows, members] =
-    view === "grid"
-      ? await Promise.all([
-          listPlanGrid(params.ws, range),
-          listWorkspaceMembers(params.ws),
-        ])
-      : [[], []];
+  // resolvedView defaults to "all"/"none" so the fallback below is inert
+  // when view !== "grid" (it's never read in that branch).
+  let gridRows: Awaited<ReturnType<typeof listPlanGrid>> = [];
+  let members: Awaited<ReturnType<typeof listWorkspaceMembers>> = [];
+  let resolvedView = resolvePlanView({}, "");
+  if (view === "grid") {
+    const [user, memberRows] = await Promise.all([
+      requireUser(),
+      listWorkspaceMembers(params.ws),
+    ]);
+    members = memberRows;
+    const clientNameById = (id: string) =>
+      clients.find((c) => c.id === id)?.name;
+    const personNameById = (id: string) =>
+      members.find((m) => m.userId === id)?.name ?? undefined;
+    resolvedView = resolvePlanView(
+      {
+        scope: searchParams.scope,
+        clientId: searchParams.clientId,
+        userId: searchParams.userId,
+        group: searchParams.group,
+      },
+      user.id,
+      clientNameById,
+      personNameById,
+    );
+    gridRows = await listPlanGrid(params.ws, range, resolvedView.filter);
+  }
   // One batched count query for the whole page, not one per row.
   const gridIds = gridRows.map((r) => r.id);
   const [pending, pendingRevisions] = await Promise.all([
     pendingRevisionCounts(params.ws, gridIds),
     pendingRevisionsForContents(params.ws, gridIds),
   ]);
   const revisionViews = pendingRevisions.map((r) => ({
     id: r.id,
     contentId: r.contentId,
     authorKind: r.authorKind,
@@ -161,29 +192,47 @@ export default async function CalendarPage({
                 ? "rounded-md border border-brand-teal/50 bg-brand-teal/10 px-3 py-1 text-white"
                 : "rounded-md border border-white/15 px-3 py-1 text-white/55 hover:text-white"
             }
           >
             {v === "month" ? "Month" : "Plan grid"}
           </Link>
         ))}
       </div>
 
       {view === "grid" ? (
-        <PlanGrid
-          workspaceId={params.ws}
-          rows={planRows}
-          members={members.map((m) => ({
-            id: m.userId,
-            label: m.name ?? m.email,
-          }))}
-          revisions={revisionViews}
-        />
+        <>
+          <ViewControls
+            ws={params.ws}
+            monthParam={monthParam(0)}
+            scope={resolvedView.scope}
+            grouping={resolvedView.grouping}
+            clientId={searchParams.clientId}
+            userId={searchParams.userId}
+            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
+            members={members.map((m) => ({
+              id: m.userId,
+              label: m.name ?? m.email,
+            }))}
+          />
+          <PlanGrid
+            workspaceId={params.ws}
+            rows={planRows}
+            members={members.map((m) => ({
+              id: m.userId,
+              label: m.name ?? m.email,
+            }))}
+            revisions={revisionViews}
+            scope={resolvedView.scope}
+            grouping={resolvedView.grouping}
+            label={resolvedView.label}
+          />
+        </>
       ) : (
         <>
           <CalendarBoard
             workspaceId={params.ws}
             weeks={dayViews}
             todayKey={todayKey}
             clients={clients.map((c) => ({ id: c.id, name: c.name }))}
           />
 
           {slots.length === 0 ? (
diff --git a/src/app/(app)/w/[ws]/calendar/plan-grid.tsx b/src/app/(app)/w/[ws]/calendar/plan-grid.tsx
index 390243d..7bf0602 100644
--- a/src/app/(app)/w/[ws]/calendar/plan-grid.tsx
+++ b/src/app/(app)/w/[ws]/calendar/plan-grid.tsx
@@ -1,18 +1,19 @@
 "use client";
 
-import { useState, useTransition } from "react";
+import { Fragment, useState, useTransition } from "react";
 import { Badge } from "@/components/ui/badge";
 import { cn } from "@/lib/utils";
 import { CONTENT_TYPE_COLORS, type ContentType } from "@/lib/colors";
 import { isVideoContentType } from "@/db/schema";
 import type { PlanCellField } from "@/lib/plan-cell";
+import { groupRows, type PlanGrouping, type PlanScope } from "@/lib/plan-view";
 import { askPlanRowAction, updatePlanCellAction } from "./actions";
 import { RevisionDrawer, type RevisionView } from "./revision-drawer";
 
 export type PlanRowView = {
   id: string;
   scheduledForIso: string | null;
   clientName: string;
   type: ContentType;
   durationSec: number | null;
   pillar: string | null;
@@ -47,40 +48,71 @@ const CONTENT_TYPES: ContentType[] = [
   "static",
 ];
 
 const cellClass =
   "w-full rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm text-white/80 outline-none hover:border-white/15 focus:border-brand-teal/60 focus:bg-white/5";
 
 function labelize(value: string) {
   return value.replace(/_/g, " ");
 }
 
+/**
+ * The empty state should say why the grid is empty in terms of the active
+ * scope, not a one-size-fits-all message — "no rows" reads very differently
+ * for "nothing exists yet" versus "nothing is assigned to you yet". Built
+ * from `label` (from resolvePlanView) rather than duplicating scope logic
+ * here, so the wording tracks whatever U2 resolves the scope to.
+ */
+function emptyStateCopy(scope: PlanScope, label: string): string {
+  switch (scope) {
+    case "mine":
+      return "Nothing assigned to you this month.";
+    case "unassigned":
+      return "Nothing unassigned this month — every row already has an owner.";
+    case "client":
+    case "person":
+      return `Nothing in ${label} this month.`;
+    case "all":
+    default:
+      return "No content this month. Add a card from Production, or accept an idea in Plan & Validate.";
+  }
+}
+
 /** datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not an ISO-Z. */
 function toLocalInput(iso: string | null, withTime: boolean) {
   if (!iso) return "";
   const d = new Date(iso);
   if (Number.isNaN(d.getTime())) return "";
   const pad = (n: number) => String(n).padStart(2, "0");
   const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
   return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
 }
 
 export function PlanGrid({
   workspaceId,
   rows: initialRows,
   members,
   revisions,
+  scope,
+  grouping,
+  label,
 }: {
   workspaceId: string;
   rows: PlanRowView[];
   members: MemberOption[];
   revisions: RevisionView[];
+  /** U2 — which scope resolvePlanView narrowed to; drives the empty state. */
+  scope: PlanScope;
+  /** U3 — grouping to render the body under; "none" renders flat. */
+  grouping: PlanGrouping;
+  /** Human-readable scope label from resolvePlanView, for the empty state. */
+  label: string;
 }) {
   const [rows, setRows] = useState(initialRows);
   const [error, setError] = useState<string | null>(null);
   const [notice, setNotice] = useState<string | null>(null);
   const [showAll, setShowAll] = useState(false);
   const [asking, setAsking] = useState<string | null>(null);
   const [openRow, setOpenRow] = useState<string | null>(null);
   const [pending, setPending] = useState(revisions);
   const [saving, startTransition] = useTransition();
 
@@ -110,21 +142,24 @@ export function PlanGrid({
         ),
       );
       setNotice(
         `Suggested ${result.fields.join(", ")} — review before it changes anything.`,
       );
     } finally {
       setAsking(null);
     }
   }
 
+  // Cap applies to the total row set before grouping — a group header is
+  // meaningless if it silently drops rows the count didn't account for.
   const visible = showAll ? rows : rows.slice(0, VISIBLE_CAP);
+  const groups = groupRows(visible, grouping);
   const scheduledCount = rows.filter((r) => r.scheduledForIso).length;
 
   function commit(
     rowId: string,
     field: PlanCellField,
     value: string | number | null,
     patch: Partial<PlanRowView>,
   ) {
     const prior = rows.find((r) => r.id === rowId);
     if (!prior) return;
@@ -145,22 +180,21 @@ export function PlanGrid({
       if (!result.ok) {
         setRows((cur) => cur.map((r) => (r.id === rowId ? prior : r)));
         setError(result.error);
       }
     });
   }
 
   if (rows.length === 0) {
     return (
       <p className="mt-6 text-sm text-white/40">
-        No content this month. Add a card from Production, or accept an idea in
-        Plan &amp; Validate.
+        {emptyStateCopy(scope, label)}
       </p>
     );
   }
 
   return (
     <div className="mt-4">
       <div className="flex items-center justify-between text-xs text-white/40">
         <span>
           {rows.length} row{rows.length === 1 ? "" : "s"}
           {scheduledCount === 0
@@ -203,21 +237,33 @@ export function PlanGrid({
                 "Due",
                 "AI",
               ].map((h) => (
                 <th key={h} className="px-2 py-2 font-medium">
                   {h}
                 </th>
               ))}
             </tr>
           </thead>
           <tbody>
-            {visible.map((row) => (
+            {groups.map((group) => (
+              <Fragment key={group.key || "__ungrouped__"}>
+                {grouping !== "none" ? (
+                  <tr className="border-b border-white/10 bg-white/[0.03]">
+                    <td
+                      colSpan={12}
+                      className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-white/50"
+                    >
+                      {group.key} ({group.rows.length})
+                    </td>
+                  </tr>
+                ) : null}
+                {group.rows.map((row) => (
               <tr
                 key={row.id}
                 className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
               >
                 <td className="px-2 py-1">
                   <input
                     type="datetime-local"
                     aria-label="Scheduled for"
                     className={cn(cellClass, "min-w-44")}
                     defaultValue={toLocalInput(row.scheduledForIso, true)}
@@ -427,20 +473,22 @@ export function PlanGrid({
                       type="button"
                       onClick={() => setOpenRow(row.id)}
                       className="ml-1.5 text-xs text-brand-teal underline-offset-2 hover:underline"
                     >
                       {row.pendingSuggestions} suggestion
                       {row.pendingSuggestions === 1 ? "" : "s"}
                     </button>
                   ) : null}
                 </td>
               </tr>
+                ))}
+              </Fragment>
             ))}
           </tbody>
         </table>
       </div>
 
       {openRow ? (
         <RevisionDrawer
           workspaceId={workspaceId}
           rowTitle={rows.find((r) => r.id === openRow)?.title ?? "This row"}
           revisions={pending.filter((r) => r.contentId === openRow)}
diff --git a/src/app/(app)/w/[ws]/calendar/view-controls.tsx b/src/app/(app)/w/[ws]/calendar/view-controls.tsx
new file mode 100644
index 0000000..caa53e3
--- /dev/null
+++ b/src/app/(app)/w/[ws]/calendar/view-controls.tsx
@@ -0,0 +1,189 @@
+"use client";
+
+import Link from "next/link";
+import { useRouter } from "next/navigation";
+import type { PlanGrouping, PlanScope } from "@/lib/plan-view";
+import { cn } from "@/lib/utils";
+
+export type ViewControlsClient = { id: string; name: string };
+export type ViewControlsPerson = { id: string; label: string };
+
+const GROUPING_TABS: { value: PlanGrouping; label: string }[] = [
+  { value: "none", label: "No grouping" },
+  { value: "client", label: "By client" },
+  { value: "status", label: "By status" },
+  { value: "pillar", label: "By pillar" },
+];
+
+/**
+ * Builds the calendar grid URL for a given combination of params, always
+ * preserving month + view=grid. Scope-specific ids are only included when
+ * they're relevant to the target scope — a stale clientId shouldn't tag
+ * along onto a "mine" link.
+ */
+function buildHref(
+  ws: string,
+  params: {
+    m: string;
+    scope?: PlanScope;
+    clientId?: string;
+    userId?: string;
+    group?: PlanGrouping;
+  },
+) {
+  const sp = new URLSearchParams();
+  sp.set("m", params.m);
+  sp.set("view", "grid");
+  if (params.scope && params.scope !== "all") sp.set("scope", params.scope);
+  if (params.clientId) sp.set("clientId", params.clientId);
+  if (params.userId) sp.set("userId", params.userId);
+  if (params.group && params.group !== "none") sp.set("group", params.group);
+  return `/w/${ws}/calendar?${sp.toString()}`;
+}
+
+/**
+ * Scope + grouping switcher for the plan grid.
+ *
+ * These are URL-driven links (and two selects that navigate on change),
+ * not client-side state: the page is a server component that refetches
+ * `listPlanGrid` per combination, and a bookmarked/shared link must
+ * reproduce the exact same view. Keeping the current selection in React
+ * state instead would desync from what the server actually rendered the
+ * moment someone reloads or shares the URL.
+ */
+export function ViewControls({
+  ws,
+  monthParam,
+  scope,
+  grouping,
+  clientId,
+  userId,
+  clients,
+  members,
+}: {
+  ws: string;
+  monthParam: string;
+  scope: PlanScope;
+  grouping: PlanGrouping;
+  clientId?: string;
+  userId?: string;
+  clients: ViewControlsClient[];
+  members: ViewControlsPerson[];
+}) {
+  const router = useRouter();
+
+  const tabClass = (active: boolean) =>
+    cn(
+      "rounded-md border px-2.5 py-1",
+      active
+        ? "border-brand-teal/50 bg-brand-teal/10 text-white"
+        : "border-white/15 text-white/55 hover:text-white",
+    );
+
+  return (
+    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
+      <div className="flex flex-wrap items-center gap-1">
+        <Link
+          href={buildHref(ws, { m: monthParam, scope: "all", group: grouping })}
+          aria-current={scope === "all" ? "page" : undefined}
+          className={tabClass(scope === "all")}
+        >
+          All clients
+        </Link>
+
+        <select
+          aria-label="One client"
+          className={tabClass(scope === "client")}
+          value={scope === "client" ? (clientId ?? "") : ""}
+          onChange={(e) => {
+            const next = e.target.value;
+            if (!next) return;
+            router.push(
+              buildHref(ws, {
+                m: monthParam,
+                scope: "client",
+                clientId: next,
+                group: grouping,
+              }),
+            );
+          }}
+        >
+          <option value="" className="bg-slate-900">
+            One client…
+          </option>
+          {clients.map((c) => (
+            <option key={c.id} value={c.id} className="bg-slate-900">
+              {c.name}
+            </option>
+          ))}
+        </select>
+
+        <Link
+          href={buildHref(ws, { m: monthParam, scope: "mine", group: grouping })}
+          aria-current={scope === "mine" ? "page" : undefined}
+          className={tabClass(scope === "mine")}
+        >
+          Assigned to me
+        </Link>
+
+        <select
+          aria-label="Someone else"
+          className={tabClass(scope === "person")}
+          value={scope === "person" ? (userId ?? "") : ""}
+          onChange={(e) => {
+            const next = e.target.value;
+            if (!next) return;
+            router.push(
+              buildHref(ws, {
+                m: monthParam,
+                scope: "person",
+                userId: next,
+                group: grouping,
+              }),
+            );
+          }}
+        >
+          <option value="" className="bg-slate-900">
+            Someone else…
+          </option>
+          {members.map((m) => (
+            <option key={m.id} value={m.id} className="bg-slate-900">
+              {m.label}
+            </option>
+          ))}
+        </select>
+
+        <Link
+          href={buildHref(ws, {
+            m: monthParam,
+            scope: "unassigned",
+            group: grouping,
+          })}
+          aria-current={scope === "unassigned" ? "page" : undefined}
+          className={tabClass(scope === "unassigned")}
+        >
+          Unassigned
+        </Link>
+      </div>
+
+      <div className="flex flex-wrap items-center gap-1 border-l border-white/10 pl-3">
+        {GROUPING_TABS.map((tab) => (
+          <Link
+            key={tab.value}
+            href={buildHref(ws, {
+              m: monthParam,
+              scope,
+              clientId: scope === "client" ? clientId : undefined,
+              userId: scope === "person" ? userId : undefined,
+              group: tab.value,
+            })}
+            aria-current={grouping === tab.value ? "page" : undefined}
+            className={tabClass(grouping === tab.value)}
+          >
+            {tab.label}
+          </Link>
+        ))}
+      </div>
+    </div>
+  );
+}
