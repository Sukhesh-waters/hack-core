# U9 review package

4e924f4 feat(u9): inline Jira-style status control for hub tasks

 src/app/(app)/w/[ws]/hub/actions.ts          |  65 +++++++-
 src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx | 219 ++++++++++++++++++---------
 src/lib/hub-workflow.test.ts                 | 117 ++++++++++++++
 src/lib/hub-workflow.ts                      | 102 +++++++++++++
 4 files changed, 421 insertions(+), 82 deletions(-)

## Diff
diff --git a/src/app/(app)/w/[ws]/hub/actions.ts b/src/app/(app)/w/[ws]/hub/actions.ts
index 53b14c6..c166c12 100644
--- a/src/app/(app)/w/[ws]/hub/actions.ts
+++ b/src/app/(app)/w/[ws]/hub/actions.ts
@@ -1,30 +1,38 @@
 "use server";
 
 import { revalidatePath } from "next/cache";
+import { and, eq } from "drizzle-orm";
 import { z } from "zod";
 import { requireUser } from "@/auth";
+import { db } from "@/db";
+import { hubTasks } from "@/db/schema";
 import { requireMembership } from "@/db/queries/memberships";
 import {
   addHubReminder,
   addHubTask,
   addHubTextMessage,
   createHubApproval,
   decideHubApproval,
-  setHubTaskDone,
   setHubTaskPriority,
 } from "@/db/queries/hub";
 import { rejectIdea } from "@/db/queries/ideas";
 import { liveTeamHub } from "@/lib/data/live/team-hub";
 import { broadcastHubSignal, type HubScope } from "@/lib/realtime";
 import { actionErrorMessage } from "@/lib/action-errors";
 import { acceptIdea } from "@/lib/plan/accept-idea";
+import {
+  doneFromHubTaskStatus,
+  HUB_TASK_STATUS_LABELS,
+  isValidHubTaskTransition,
+  type HubTaskStatus,
+} from "@/lib/hub-workflow";
 import type { TeamHubData } from "@/lib/data/types";
 
 export type HubActionResult =
   | { data: TeamHubData; error?: undefined }
   | { data?: undefined; error: string };
 
 const ws = z.string().min(1);
 
 async function guard(workspaceId: string) {
   const user = await requireUser();
@@ -140,35 +148,78 @@ export async function createTask(
       workspaceId: input.workspaceId,
       createdById: user.id,
       title: input.title,
     });
     return await stateAfter(input.workspaceId, "tasks");
   } catch (error) {
     return { error: actionErrorMessage(error) };
   }
 }
 
-const taskDoneSchema = z.object({
+const taskStatusSchema = z.object({
   workspaceId: ws,
   taskId: z.string().min(1),
-  done: z.boolean(),
+  from: z.enum(["open", "done"]),
+  to: z.enum(["open", "done"]),
 });
 
-export async function setTaskDone(
+/**
+ * Moves a hub task between "open" and "done" (the view over `done` defined
+ * in `@/lib/hub-workflow`). Never trusts the client's claimed `from` alone —
+ * `isValidHubTaskTransition` re-checks it server-side against the same graph
+ * the menu rendered from, and the UPDATE's WHERE clause matches on the
+ * current `done` value too. If another change (or another tab) already
+ * moved the task, 0 rows match and this reports "already changed" instead
+ * of silently overwriting whatever the task had become.
+ *
+ * No activity row is written for this move: `hubTasks` is a deliberate
+ * scratch list (see CLAUDE.md — no assignee column, never promoted to a
+ * ticket in place), and none of `activitySubject`'s allowed values
+ * ("content" | "idea" | "ticket" | "campaign" | "doc" | "client") honestly
+ * describes a hub task. Mislabelling it under "ticket" would blur exactly
+ * the distinction the scratch-list design is protecting, so this is skipped
+ * rather than mislabelled.
+ */
+export async function setHubTaskStatus(
   workspaceId: string,
   taskId: string,
-  done: boolean,
+  from: HubTaskStatus,
+  to: HubTaskStatus,
 ): Promise<HubActionResult> {
   try {
-    const input = taskDoneSchema.parse({ workspaceId, taskId, done });
+    const input = taskStatusSchema.parse({ workspaceId, taskId, from, to });
+    if (!isValidHubTaskTransition(input.from, input.to)) {
+      return {
+        error: `Can't move a task from ${HUB_TASK_STATUS_LABELS[input.from]} to ${HUB_TASK_STATUS_LABELS[input.to]}.`,
+      };
+    }
     await guard(input.workspaceId);
-    await setHubTaskDone(input);
+
+    const updated = await db
+      .update(hubTasks)
+      .set({ done: doneFromHubTaskStatus(input.to) })
+      .where(
+        and(
+          eq(hubTasks.workspaceId, input.workspaceId),
+          eq(hubTasks.id, input.taskId),
+          eq(hubTasks.done, doneFromHubTaskStatus(input.from)),
+        ),
+      )
+      .returning({ id: hubTasks.id });
+
+    if (updated.length === 0) {
+      return {
+        error:
+          "This task already changed — refresh to see its latest status.",
+      };
+    }
+
     return await stateAfter(input.workspaceId, "tasks");
   } catch (error) {
     return { error: actionErrorMessage(error) };
   }
 }
 
 const taskPrioritySchema = z.object({
   workspaceId: ws,
   taskId: z.string().min(1),
   priority: z.enum(["high", "medium", "low"]),
diff --git a/src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx b/src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx
index 112e5b8..29fc17c 100644
--- a/src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx
+++ b/src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx
@@ -1,26 +1,34 @@
 "use client";
 
 import { useCallback, useEffect, useRef, useState, useTransition } from "react";
 import { GlassCard } from "@/components/glass-card";
 import { Badge } from "@/components/ui/badge";
+import { StatusMenu, type TransitionOption } from "@/components/transition-menu";
 import { cn } from "@/lib/utils";
 import type { HubMessage, HubPriority, TeamHubData } from "@/lib/data/types";
+import {
+  HUB_TASK_STATUS_CHIP_CLASSES,
+  HUB_TASK_STATUS_LABELS,
+  hubTaskStatusFromDone,
+  nextHubTaskStatusesFrom,
+  type HubTaskStatus,
+} from "@/lib/hub-workflow";
 import {
   createReminder,
   createTask,
   decideApproval,
   decidePlanIdea,
   fetchHubState,
   requestHubApproval,
   sendHubMessage,
-  setTaskDone,
+  setHubTaskStatus,
   setTaskPriority,
   type HubActionResult,
 } from "./actions";
 import { useHubRealtime } from "./use-hub-realtime";
 
 const PRIORITY_STYLES: Record<HubPriority, string> = {
   High: "border-red-400/40 text-red-400",
   Medium: "border-brand-purple/40 text-brand-purple",
   Low: "border-white/20 text-white/40",
 };
@@ -44,32 +52,62 @@ export function TeamHubCanvas({
   const [data, setData] = useState(initial);
   const [draft, setDraft] = useState("");
   const [taskDraft, setTaskDraft] = useState("");
   const [reminderDraft, setReminderDraft] = useState("");
   const [reminderDue, setReminderDue] = useState("");
   const [error, setError] = useState<string | null>(null);
   // Plan accept now generates a real AI draft (multi-second) instead of a
   // bare status flip — without this, a second click before the first
   // resolves double-generates the draft (idea.status hasn't updated yet).
   const [decidingIdeaId, setDecidingIdeaId] = useState<string | null>(null);
+  // Every action trigger below keys into this set while its server
+  // round-trip is in flight, so each button (not just Plan accept/reject)
+  // can show a busy state instead of looking dead. Keyed rather than a
+  // single boolean so e.g. approving one item doesn't grey out every other
+  // control on the screen.
+  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
   const [, startTransition] = useTransition();
   const scrollRef = useRef<HTMLDivElement>(null);
 
+  const isBusy = useCallback(
+    (key: string) => busyKeys.has(key),
+    [busyKeys],
+  );
+
   const apply = useCallback((res: HubActionResult) => {
     if (res.data) {
       setError(null);
       setData(res.data);
     } else {
       setError(res.error ?? "Something went wrong.");
     }
   }, []);
 
+  /** Marks `key` busy for the duration of `fn`, then applies its result. */
+  const runAction = useCallback(
+    (key: string, fn: () => Promise<HubActionResult>) => {
+      setBusyKeys((prev) => new Set(prev).add(key));
+      startTransition(async () => {
+        try {
+          apply(await fn());
+        } finally {
+          setBusyKeys((prev) => {
+            const next = new Set(prev);
+            next.delete(key);
+            return next;
+          });
+        }
+      });
+    },
+    [apply],
+  );
+
   const refresh = useCallback(() => {
     startTransition(async () => {
       const res = await fetchHubState(workspaceId);
       // Silent refresh: keep the screen if a poll hiccups
       if (res.data) setData(res.data);
     });
   }, [workspaceId]);
 
   const { onlineIds } = useHubRealtime({
     workspaceId,
@@ -100,82 +138,93 @@ export function TeamHubCanvas({
         {
           id: `tmp-${Date.now()}`,
           kind: "text",
           time: "just now",
           author: me.name,
           initial: (me.name[0] ?? "Y").toUpperCase(),
           text,
         },
       ],
     }));
-    startTransition(async () => apply(await sendHubMessage(workspaceId, text)));
+    runAction("message", () => sendHubMessage(workspaceId, text));
   };
 
   const requestApproval = () => {
     const title = draft.trim() || "Untitled asset";
     setDraft("");
-    startTransition(async () =>
-      apply(await requestHubApproval(workspaceId, title)),
+    runAction("approval-request", () =>
+      requestHubApproval(workspaceId, title),
     );
   };
 
   const decide = (approvalId: string, decision: "approved" | "rejected") =>
-    startTransition(async () =>
-      apply(await decideApproval(workspaceId, approvalId, decision)),
+    runAction(`approval:${approvalId}`, () =>
+      decideApproval(workspaceId, approvalId, decision),
     );
 
   const addTask = () => {
     const title = taskDraft.trim();
     if (!title) return;
     setTaskDraft("");
-    startTransition(async () => apply(await createTask(workspaceId, title)));
+    runAction("add-task", () => createTask(workspaceId, title));
   };
 
-  const toggleTask = (id: string, done: boolean) =>
-    startTransition(async () =>
-      apply(await setTaskDone(workspaceId, id, !done)),
+  const changeTaskStatus = (
+    id: string,
+    from: HubTaskStatus,
+    to: HubTaskStatus,
+  ) =>
+    runAction(`task-status:${id}`, () =>
+      setHubTaskStatus(workspaceId, id, from, to),
     );
 
   const cyclePriority = (id: string, current: HubPriority) =>
-    startTransition(async () =>
-      apply(await setTaskPriority(workspaceId, id, NEXT_PRIORITY[current])),
+    runAction(`task-priority:${id}`, () =>
+      setTaskPriority(workspaceId, id, NEXT_PRIORITY[current]),
     );
 
   const decidePlan = (ideaId: string, decision: "accepted" | "rejected") => {
     if (decidingIdeaId) return; // already deciding one — ignore re-clicks
     setDecidingIdeaId(ideaId);
     startTransition(async () => {
       apply(await decidePlanIdea(workspaceId, ideaId, decision));
       setDecidingIdeaId(null);
     });
   };
 
   const addReminder = () => {
     const title = reminderDraft.trim();
     if (!title || !reminderDue) return;
     const iso = new Date(reminderDue).toISOString();
     setReminderDraft("");
     setReminderDue("");
-    startTransition(async () =>
-      apply(await createReminder(workspaceId, title, iso)),
-    );
+    runAction("add-reminder", () => createReminder(workspaceId, title, iso));
   };
 
   const openTasks = data.tasks.filter((t) => !t.done).length;
   const pendingApprovals = data.approvals.filter(
     (a) => a.status === "pending",
   ).length;
   const onlineCount =
     data.members.filter((m) => onlineIds.has(m.id)).length || 1;
 
   return (
-    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
+    <div className="space-y-3">
+      {error && (
+        <p
+          className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-xs text-red-400"
+          role="alert"
+        >
+          {error}
+        </p>
+      )}
+      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
       {/* ---- CHAT PANE ---- */}
       <GlassCard className="flex h-[640px] flex-col p-0">
         <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
           <p className="text-sm font-medium">{data.channel}</p>
           <div className="flex items-center gap-2">
             <div className="flex -space-x-2">
               {data.members.map((mb) => (
                 <div
                   key={mb.id}
                   title={mb.name}
@@ -195,48 +244,46 @@ export function TeamHubCanvas({
           </div>
         </div>
 
         <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
           {data.messages.length === 0 && (
             <p className="label-mono text-center text-[10px] text-white/30">
               Channel is live — say hello or request a sign-off.
             </p>
           )}
           {data.messages.map((m) => (
-            <MessageRow key={m.id} m={m} onDecide={decide} />
+            <MessageRow key={m.id} m={m} onDecide={decide} isBusy={isBusy} />
           ))}
         </div>
 
-        {error && (
-          <p className="px-5 pb-1 text-xs text-red-400" role="alert">
-            {error}
-          </p>
-        )}
         <div className="flex items-center gap-2 border-t border-white/10 p-4">
           <input
             value={draft}
             onChange={(e) => setDraft(e.target.value)}
             onKeyDown={(e) => e.key === "Enter" && sendMessage()}
             placeholder="Message the team — or type an asset name and request sign-off"
-            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-brand-teal/50"
+            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-brand-teal/50 disabled:opacity-50"
+            disabled={isBusy("message")}
           />
           <button
             onClick={requestApproval}
-            className="label-mono rounded-xl border border-brand-purple/40 px-3 py-2.5 text-[10px] text-brand-purple transition hover:bg-brand-purple/10"
+            disabled={isBusy("approval-request")}
+            className="label-mono rounded-xl border border-brand-purple/40 px-3 py-2.5 text-[10px] text-brand-purple transition hover:bg-brand-purple/10 disabled:cursor-not-allowed disabled:opacity-50"
           >
-            Approval
+            {isBusy("approval-request") ? "Requesting…" : "Approval"}
           </button>
           <button
             onClick={sendMessage}
-            className="rounded-xl bg-white/10 px-4 py-2.5 text-sm transition hover:bg-white/15"
+            disabled={isBusy("message")}
+            className="rounded-xl bg-white/10 px-4 py-2.5 text-sm transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
           >
-            Send →
+            {isBusy("message") ? "Sending…" : "Send →"}
           </button>
         </div>
       </GlassCard>
 
       {/* ---- PINNED ACTION RAIL ---- */}
       <div className="space-y-4">
         <GlassCard className="p-4">
           <div className="flex items-center justify-between">
             <p className="label-mono text-brand-teal">Plan · Validate</p>
           </div>
@@ -316,29 +363,31 @@ export function TeamHubCanvas({
                     {aq.status}
                   </Badge>
                 </div>
                 <p className="mt-0.5 text-[10px] text-white/40">
                   {aq.requestedBy} · {aq.time}
                 </p>
                 {aq.status === "pending" && (
                   <div className="mt-2 flex gap-2">
                     <button
                       onClick={() => decide(aq.id, "approved")}
-                      className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-brand-teal hover:bg-white/15"
+                      disabled={isBusy(`approval:${aq.id}`)}
+                      className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-brand-teal hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                     >
-                      ✓ Approve
+                      {isBusy(`approval:${aq.id}`) ? "…" : "✓ Approve"}
                     </button>
                     <button
                       onClick={() => decide(aq.id, "rejected")}
-                      className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-red-400 hover:bg-white/15"
+                      disabled={isBusy(`approval:${aq.id}`)}
+                      className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-red-400 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                     >
-                      ✕ Reject
+                      {isBusy(`approval:${aq.id}`) ? "…" : "✕ Reject"}
                     </button>
                   </div>
                 )}
                 {aq.status !== "pending" && aq.decidedBy && (
                   <p className="mt-1 text-[10px] text-white/30">
                     {aq.status} by {aq.decidedBy}
                   </p>
                 )}
               </div>
             ))}
@@ -346,67 +395,79 @@ export function TeamHubCanvas({
         </GlassCard>
 
         <GlassCard className="p-4">
           <div className="flex items-center justify-between">
             <p className="label-mono text-white/60">Tasks & priorities</p>
             <p className="label-mono text-[10px] text-white/40">
               {openTasks} open
             </p>
           </div>
           <div className="mt-3 space-y-1.5">
-            {data.tasks.map((tk) => (
-              <div key={tk.id} className="flex items-center gap-2">
-                <button
-                  onClick={() => toggleTask(tk.id, tk.done)}
-                  className={cn(
-                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px]",
-                    tk.done
-                      ? "border-brand-teal/50 text-brand-teal"
-                      : "border-white/20 text-transparent",
-                  )}
-                >
-                  ✓
-                </button>
-                <p
-                  className={cn(
-                    "flex-1 truncate text-xs",
-                    tk.done && "text-white/30 line-through",
-                  )}
-                >
-                  {tk.title}
-                </p>
-                <button
-                  onClick={() => cyclePriority(tk.id, tk.priority)}
-                  title="Click to change priority"
-                  className={cn(
-                    "label-mono shrink-0 rounded-md border px-1.5 py-0.5 text-[9px]",
-                    PRIORITY_STYLES[tk.priority],
-                  )}
-                >
-                  {tk.priority}
-                </button>
-              </div>
-            ))}
+            {data.tasks.map((tk) => {
+              const status = hubTaskStatusFromDone(tk.done);
+              const options: TransitionOption<HubTaskStatus>[] =
+                nextHubTaskStatusesFrom(status).map((opt) => ({
+                  value: opt.status,
+                  label: HUB_TASK_STATUS_LABELS[opt.status],
+                  allowed: opt.allowed,
+                  reason: opt.reason,
+                  chipClass: HUB_TASK_STATUS_CHIP_CLASSES[opt.status],
+                }));
+              return (
+                <div key={tk.id} className="flex items-center gap-2">
+                  <StatusMenu
+                    current={status}
+                    currentLabel={HUB_TASK_STATUS_LABELS[status]}
+                    currentChipClass={HUB_TASK_STATUS_CHIP_CLASSES[status]}
+                    options={options}
+                    onSelect={(to) => changeTaskStatus(tk.id, status, to)}
+                    disabled={isBusy(`task-status:${tk.id}`)}
+                    label={tk.title}
+                  />
+                  <p
+                    className={cn(
+                      "flex-1 truncate text-xs",
+                      tk.done && "text-white/30 line-through",
+                    )}
+                  >
+                    {tk.title}
+                  </p>
+                  <button
+                    onClick={() => cyclePriority(tk.id, tk.priority)}
+                    disabled={isBusy(`task-priority:${tk.id}`)}
+                    title="Click to change priority"
+                    className={cn(
+                      "label-mono shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] disabled:cursor-not-allowed disabled:opacity-50",
+                      PRIORITY_STYLES[tk.priority],
+                    )}
+                  >
+                    {isBusy(`task-priority:${tk.id}`) ? "…" : tk.priority}
+                  </button>
+                </div>
+              );
+            })}
           </div>
           <div className="mt-3 flex gap-2">
             <input
               value={taskDraft}
               onChange={(e) => setTaskDraft(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && addTask()}
               placeholder="Add a task…"
-              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-brand-teal/50"
+              disabled={isBusy("add-task")}
+              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-brand-teal/50 disabled:opacity-50"
             />
             <button
               onClick={addTask}
-              className="label-mono rounded-lg bg-white/10 px-3 py-1.5 text-[10px] hover:bg-white/15"
+              disabled={isBusy("add-task")}
+              className="label-mono rounded-lg bg-white/10 px-3 py-1.5 text-[10px] hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
             >
-              Add
+              {isBusy("add-task") ? "Adding…" : "Add"}
             </button>
           </div>
         </GlassCard>
 
         <GlassCard className="p-4">
           <p className="label-mono text-white/60">Shared reminders</p>
           <div className="mt-3 space-y-2">
             {data.reminders.length === 0 && (
               <p className="text-xs text-white/40">No reminders yet.</p>
             )}
@@ -417,49 +478,55 @@ export function TeamHubCanvas({
                   {r.due} · {r.owner}
                 </p>
               </div>
             ))}
           </div>
           <div className="mt-3 space-y-2">
             <input
               value={reminderDraft}
               onChange={(e) => setReminderDraft(e.target.value)}
               placeholder="Add a shared reminder…"
-              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-brand-teal/50"
+              disabled={isBusy("add-reminder")}
+              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-brand-teal/50 disabled:opacity-50"
             />
             <div className="flex gap-2">
               <input
                 type="datetime-local"
                 value={reminderDue}
                 onChange={(e) => setReminderDue(e.target.value)}
-                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 outline-none focus:border-brand-teal/50 [color-scheme:dark]"
+                disabled={isBusy("add-reminder")}
+                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 outline-none focus:border-brand-teal/50 [color-scheme:dark] disabled:opacity-50"
               />
               <button
                 onClick={addReminder}
-                className="label-mono rounded-lg bg-white/10 px-3 py-1.5 text-[10px] hover:bg-white/15"
+                disabled={isBusy("add-reminder")}
+                className="label-mono rounded-lg bg-white/10 px-3 py-1.5 text-[10px] hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
               >
-                Add
+                {isBusy("add-reminder") ? "Adding…" : "Add"}
               </button>
             </div>
           </div>
         </GlassCard>
       </div>
+      </div>
     </div>
   );
 }
 
 function MessageRow({
   m,
   onDecide,
+  isBusy,
 }: {
   m: HubMessage;
   onDecide: (approvalId: string, decision: "approved" | "rejected") => void;
+  isBusy: (key: string) => boolean;
 }) {
   if (m.kind === "system") {
     return (
       <p className="label-mono text-center text-[10px] text-white/30">
         {m.text}
       </p>
     );
   }
 
   return (
@@ -485,29 +552,31 @@ function MessageRow({
               </p>
               <p className="label-mono text-[10px] text-white/40">
                 {m.status}
               </p>
             </div>
             <p className="mt-1 text-sm">{m.title}</p>
             {m.status === "pending" && (
               <div className="mt-2 flex gap-2">
                 <button
                   onClick={() => onDecide(m.approvalId, "approved")}
-                  className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-brand-teal hover:bg-white/15"
+                  disabled={isBusy(`approval:${m.approvalId}`)}
+                  className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-brand-teal hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                 >
-                  ✓ Approve
+                  {isBusy(`approval:${m.approvalId}`) ? "…" : "✓ Approve"}
                 </button>
                 <button
                   onClick={() => onDecide(m.approvalId, "rejected")}
-                  className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-red-400 hover:bg-white/15"
+                  disabled={isBusy(`approval:${m.approvalId}`)}
+                  className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-red-400 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                 >
-                  ✕ Reject
+                  {isBusy(`approval:${m.approvalId}`) ? "…" : "✕ Reject"}
                 </button>
               </div>
             )}
             {m.status !== "pending" && m.decidedBy && (
               <p className="mt-1 text-[10px] text-white/30">
                 {m.status} by {m.decidedBy}
               </p>
             )}
           </div>
         )}
diff --git a/src/lib/hub-workflow.test.ts b/src/lib/hub-workflow.test.ts
new file mode 100644
index 0000000..1240e0e
--- /dev/null
+++ b/src/lib/hub-workflow.test.ts
@@ -0,0 +1,117 @@
+import { describe, expect, it } from "vitest";
+import {
+  doneFromHubTaskStatus,
+  HUB_TASK_STATUS_ORDER,
+  hubTaskStatusFromDone,
+  isValidHubTaskTransition,
+  nextHubTaskStatusesFrom,
+  transitionsForHubTask,
+  type HubTaskStatus,
+} from "./hub-workflow";
+
+describe("HUB_TASK_STATUS_ORDER", () => {
+  it("is the two-node open/done view over the done boolean", () => {
+    expect(HUB_TASK_STATUS_ORDER).toEqual(["open", "done"]);
+  });
+});
+
+describe("transitionsForHubTask", () => {
+  it("open moves to done (mark done)", () => {
+    const transitions = transitionsForHubTask("open");
+    expect(transitions).toEqual([{ to: "done", label: "Mark done" }]);
+  });
+
+  it("done moves to open (reopen)", () => {
+    const transitions = transitionsForHubTask("done");
+    expect(transitions).toEqual([{ to: "open", label: "Reopen" }]);
+  });
+});
+
+describe("isValidHubTaskTransition", () => {
+  it("allows marking an open task done", () => {
+    expect(isValidHubTaskTransition("open", "done")).toBe(true);
+  });
+
+  it("allows reopening a done task", () => {
+    expect(isValidHubTaskTransition("done", "open")).toBe(true);
+  });
+
+  it("rejects a no-op move to the same status", () => {
+    expect(isValidHubTaskTransition("open", "open")).toBe(false);
+    expect(isValidHubTaskTransition("done", "done")).toBe(false);
+  });
+});
+
+describe("nextHubTaskStatusesFrom", () => {
+  it("returns every status, never a subset", () => {
+    for (const status of HUB_TASK_STATUS_ORDER) {
+      const options = nextHubTaskStatusesFrom(status);
+      expect(options.map((o) => o.status)).toEqual(HUB_TASK_STATUS_ORDER);
+    }
+  });
+
+  it("marks the legal transition allowed with no reason", () => {
+    const fromOpen = nextHubTaskStatusesFrom("open");
+    const toDone = fromOpen.find((o) => o.status === "done");
+    expect(toDone?.allowed).toBe(true);
+    expect(toDone?.reason).toBeUndefined();
+
+    const fromDone = nextHubTaskStatusesFrom("done");
+    const toOpen = fromDone.find((o) => o.status === "open");
+    expect(toOpen?.allowed).toBe(true);
+    expect(toOpen?.reason).toBeUndefined();
+  });
+
+  it("marks the current status itself as disabled with a reason", () => {
+    for (const status of HUB_TASK_STATUS_ORDER) {
+      const options = nextHubTaskStatusesFrom(status);
+      const self = options.find((o) => o.status === status);
+      expect(self?.allowed).toBe(false);
+      expect(self?.reason).toBeTruthy();
+    }
+  });
+
+  it("property: never marks a transition allowed that isValidHubTaskTransition rejects, over every status pair", () => {
+    for (const from of HUB_TASK_STATUS_ORDER) {
+      const options = nextHubTaskStatusesFrom(from);
+      for (const option of options) {
+        const graphSaysLegal = isValidHubTaskTransition(
+          from,
+          option.status as HubTaskStatus,
+        );
+        if (option.allowed) {
+          expect(graphSaysLegal).toBe(true);
+        } else {
+          expect(graphSaysLegal).toBe(false);
+        }
+      }
+    }
+
+    // Exhaustive over every (from, to) pair, not just what
+    // nextHubTaskStatusesFrom happens to enumerate — a stronger form of the
+    // same guarantee.
+    for (const from of HUB_TASK_STATUS_ORDER) {
+      for (const to of HUB_TASK_STATUS_ORDER) {
+        const options = nextHubTaskStatusesFrom(from);
+        const option = options.find((o) => o.status === to);
+        expect(option).toBeDefined();
+        expect(option?.allowed).toBe(isValidHubTaskTransition(from, to));
+      }
+    }
+  });
+});
+
+describe("done <-> status view", () => {
+  it("round-trips done through the status view", () => {
+    expect(hubTaskStatusFromDone(false)).toBe("open");
+    expect(hubTaskStatusFromDone(true)).toBe("done");
+    expect(doneFromHubTaskStatus("open")).toBe(false);
+    expect(doneFromHubTaskStatus("done")).toBe(true);
+  });
+
+  it("is a true inverse pair for every status", () => {
+    for (const status of HUB_TASK_STATUS_ORDER) {
+      expect(hubTaskStatusFromDone(doneFromHubTaskStatus(status))).toBe(status);
+    }
+  });
+});
diff --git a/src/lib/hub-workflow.ts b/src/lib/hub-workflow.ts
new file mode 100644
index 0000000..963afe7
--- /dev/null
+++ b/src/lib/hub-workflow.ts
@@ -0,0 +1,102 @@
+/**
+ * Status graph for hub tasks. Mirrors the shape of `src/lib/idea-workflow.ts`
+ * on purpose — same "labels + chip classes + transition table + allowed-with-
+ * reason lookup" pattern, so the generic `StatusMenu` from
+ * `transition-menu.tsx` can back both surfaces without a bespoke widget per
+ * screen.
+ *
+ * `hubTasks` has no `status` column by design (see CLAUDE.md scope note) —
+ * only a `done: boolean`. `HubTaskStatus` is a view over that boolean, not a
+ * new persisted field: "open" is `done = false`, "done" is `done = true`.
+ * `hubTaskStatusFromDone` / `doneFromHubTaskStatus` are the two directions of
+ * that mapping, so nothing else needs to know the boolean is the source of
+ * truth.
+ */
+
+export type HubTaskStatus = "open" | "done";
+
+/** Single source of truth for status order. */
+export const HUB_TASK_STATUS_ORDER: HubTaskStatus[] = ["open", "done"];
+
+export const HUB_TASK_STATUS_LABELS: Record<HubTaskStatus, string> = {
+  open: "Open",
+  done: "Done",
+};
+
+/**
+ * Static, fully-written Tailwind class strings (JIT scans source text, so
+ * nothing here may be template-built).
+ */
+export const HUB_TASK_STATUS_CHIP_CLASSES: Record<HubTaskStatus, string> = {
+  open: "bg-white/10 text-white/60",
+  done: "bg-brand-teal/15 text-brand-teal",
+};
+
+export type HubTaskTransition = {
+  to: HubTaskStatus;
+  label: string;
+};
+
+/**
+ * A two-node graph, not a line: open and done can each move to the other
+ * (mark done / reopen). The only thing this menu ever refuses is a no-op
+ * move to the status a task is already in.
+ */
+const TRANSITIONS: Record<HubTaskStatus, HubTaskTransition[]> = {
+  open: [{ to: "done", label: "Mark done" }],
+  done: [{ to: "open", label: "Reopen" }],
+};
+
+export function transitionsForHubTask(status: HubTaskStatus): HubTaskTransition[] {
+  return TRANSITIONS[status];
+}
+
+export function isValidHubTaskTransition(
+  from: HubTaskStatus,
+  to: HubTaskStatus,
+): boolean {
+  return TRANSITIONS[from].some((t) => t.to === to);
+}
+
+export type NextHubTaskStatusOption = {
+  status: HubTaskStatus;
+  allowed: boolean;
+  /** Present whenever allowed is false — why this move isn't on the table. */
+  reason?: string;
+};
+
+/**
+ * Every hub task status, flagged for whether `current` can legally move to
+ * it right now. Illegal destinations are never omitted, they're returned
+ * disabled with a short reason — a greyed transition teaches the workflow,
+ * a hidden one just confuses. `allowed` is always derived from
+ * `isValidHubTaskTransition`, so this can never offer a move the transition
+ * graph rejects.
+ */
+export function nextHubTaskStatusesFrom(
+  current: HubTaskStatus,
+): NextHubTaskStatusOption[] {
+  return HUB_TASK_STATUS_ORDER.map((status) => {
+    if (status === current) {
+      return { status, allowed: false, reason: "this is the current status" };
+    }
+    if (isValidHubTaskTransition(current, status)) {
+      return { status, allowed: true };
+    }
+    return {
+      status,
+      allowed: false,
+      reason: `not reachable from ${HUB_TASK_STATUS_LABELS[current].toLowerCase()}`,
+    };
+  });
+}
+
+/** View: the persisted `done` boolean as a status. */
+export function hubTaskStatusFromDone(done: boolean): HubTaskStatus {
+  return done ? "done" : "open";
+}
+
+/** Inverse view: a status back to the persisted `done` boolean. */
+export function doneFromHubTaskStatus(status: HubTaskStatus): boolean {
+  return status === "done";
+}
