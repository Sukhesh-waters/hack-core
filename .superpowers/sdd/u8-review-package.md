# U8 review package

40b1702 feat(u8): one workflow-respecting status menu for Ideation and Plan & Validate

 src/app/(app)/w/[ws]/ideation/actions.ts    |  37 +++++++
 src/app/(app)/w/[ws]/ideation/idea-card.tsx | 133 ++++++++++++++++++----
 src/app/(app)/w/[ws]/plan/page.tsx          |   3 +
 src/app/(app)/w/[ws]/plan/plan-card.tsx     |  82 +++++++++-----
 src/components/transition-menu.tsx          | 164 +++++++++++++++++++---------
 src/lib/idea-workflow.test.ts               | 116 ++++++++++++++++++++
 src/lib/idea-workflow.ts                    |  87 +++++++++++++++
 7 files changed, 520 insertions(+), 102 deletions(-)

## Diff
diff --git a/src/app/(app)/w/[ws]/ideation/actions.ts b/src/app/(app)/w/[ws]/ideation/actions.ts
index 28e7f86..2f1b5d6 100644
--- a/src/app/(app)/w/[ws]/ideation/actions.ts
+++ b/src/app/(app)/w/[ws]/ideation/actions.ts
@@ -1,19 +1,20 @@
 "use server";
 
 import { revalidatePath } from "next/cache";
 import { redirect } from "next/navigation";
 import { z } from "zod";
 import { requireUser } from "@/auth";
 import { db } from "@/db";
 import { ideas } from "@/db/schema";
 import { getBrandProfile } from "@/db/queries/brand";
+import { rejectIdea } from "@/db/queries/ideas";
 import { requireMembership } from "@/db/queries/memberships";
 import { actionErrorMessage } from "@/lib/action-errors";
 import {
   brandDnaFromProfile,
   NO_BRAND_CONTEXT_ERROR,
 } from "@/lib/ai/brand-merge";
 import { generateIdeas, markDeclaredOnly } from "@/lib/ai/ideation-agent";
 import { retrieveDrivers } from "@/lib/ai/retrieval";
 import { runWithAiCost } from "@/lib/ai/usage-context";
 import { MIN_BASELINE_N } from "@/lib/scoring";
@@ -118,10 +119,46 @@ export async function draftIdea(
   try {
     const user = await requireUser();
     await requireMembership(workspaceId, user.id);
     ({ contentId } = await acceptIdea({ workspaceId, ideaId, actorId: user.id }));
   } catch (error) {
     return { error: actionErrorMessage(error) };
   }
 
   redirect(`/w/${workspaceId}/studio/${contentId}`);
 }
+
+const rejectSchema = z.object({
+  workspaceId: z.string().min(1),
+  ideaId: z.string().min(1),
+  reason: z.string().trim().min(3, "Give a reason").max(500),
+});
+
+/**
+ * Ideation's own reject path — mirrors Plan & Validate's rejectIdeaAction so
+ * the status menu on this surface can archive an idea without leaving the
+ * page. Shares the same guarded query (status="new" only), so a stale form
+ * can't mutate an already-decided idea from either surface.
+ */
+export async function rejectIdeaAction(
+  _prev: IdeationState,
+  formData: FormData,
+): Promise<IdeationState> {
+  const parsed = rejectSchema.safeParse({
+    workspaceId: formData.get("workspaceId"),
+    ideaId: formData.get("ideaId"),
+    reason: formData.get("reason"),
+  });
+  if (!parsed.success) return { error: parsed.error.issues[0].message };
+  const { workspaceId, ideaId, reason } = parsed.data;
+
+  try {
+    const user = await requireUser();
+    await requireMembership(workspaceId, user.id);
+    await rejectIdea(workspaceId, ideaId, reason);
+  } catch (error) {
+    return { error: actionErrorMessage(error) };
+  }
+
+  revalidatePath(`/w/${workspaceId}/ideation`);
+  return undefined;
+}
diff --git a/src/app/(app)/w/[ws]/ideation/idea-card.tsx b/src/app/(app)/w/[ws]/ideation/idea-card.tsx
index 47c3659..a3f3ec3 100644
--- a/src/app/(app)/w/[ws]/ideation/idea-card.tsx
+++ b/src/app/(app)/w/[ws]/ideation/idea-card.tsx
@@ -1,48 +1,127 @@
 "use client";
 
-import { useFormState, useFormStatus } from "react-dom";
+import { useState, useTransition } from "react";
 import { Badge } from "@/components/ui/badge";
 import { Button } from "@/components/ui/button";
+import { Textarea } from "@/components/ui/textarea";
 import { GlassCard } from "@/components/glass-card";
-import { draftIdea, type IdeationState } from "./actions";
+import { StatusMenu, type TransitionOption } from "@/components/transition-menu";
+import {
+  IDEA_STATUS_CHIP_CLASSES,
+  IDEA_STATUS_LABELS,
+  nextIdeaStatusesFrom,
+  type IdeaStatus,
+} from "@/lib/idea-workflow";
+import { draftIdea, rejectIdeaAction } from "./actions";
 
 export type IdeaView = {
   id: string;
   hook: string;
   angle: string | null;
   format: string | null;
   whyReason: string | null;
   citedCaptions: string[];
-  status: "new" | "drafted" | "archived";
+  status: IdeaStatus;
 };
 
-function DraftButton({ drafted }: { drafted: boolean }) {
-  const { pending } = useFormStatus();
-  return (
-    <Button type="submit" size="sm" disabled={pending || drafted}>
-      {pending ? "Drafting…" : drafted ? "Drafted" : "Draft it"}
-    </Button>
-  );
-}
-
 export function IdeaCard({
   workspaceId,
   idea,
 }: {
   workspaceId: string;
   idea: IdeaView;
 }) {
-  const [state, formAction] = useFormState<IdeationState, FormData>(
-    draftIdea,
-    undefined,
-  );
+  const [mode, setMode] = useState<"view" | "rejecting">("view");
+  const [reason, setReason] = useState("");
+  const [error, setError] = useState<string | null>(null);
+  const [pending, startTransition] = useTransition();
+
+  const statusOptions: TransitionOption<IdeaStatus>[] = nextIdeaStatusesFrom(
+    idea.status,
+  ).map((option) => ({
+    value: option.status,
+    label: IDEA_STATUS_LABELS[option.status],
+    allowed: option.allowed,
+    reason: option.reason,
+    chipClass: IDEA_STATUS_CHIP_CLASSES[option.status],
+  }));
+
+  function handleStatusSelect(to: IdeaStatus) {
+    setError(null);
+    if (to === "archived") {
+      setMode("rejecting");
+      return;
+    }
+    if (to === "drafted") {
+      const formData = new FormData();
+      formData.set("workspaceId", workspaceId);
+      formData.set("ideaId", idea.id);
+      // draftIdea runs the AI draft generation and redirects to Studio on
+      // success — the multi-second gap before that redirect is exactly why
+      // the trigger needs a visible busy state, not a dead-looking button.
+      startTransition(async () => {
+        const result = await draftIdea(undefined, formData);
+        if (result?.error) setError(result.error);
+      });
+    }
+  }
+
+  function handleConfirmReject() {
+    setError(null);
+    const formData = new FormData();
+    formData.set("workspaceId", workspaceId);
+    formData.set("ideaId", idea.id);
+    formData.set("reason", reason);
+    startTransition(async () => {
+      const result = await rejectIdeaAction(undefined, formData);
+      if (result?.error) {
+        setError(result.error);
+        return;
+      }
+      setMode("view");
+    });
+  }
+
+  if (mode === "rejecting") {
+    return (
+      <GlassCard className="space-y-3 p-5">
+        <p className="label-mono text-white/40">Reject — give a reason</p>
+        <Textarea
+          value={reason}
+          onChange={(e) => setReason(e.target.value)}
+          placeholder="Why doesn't this idea fit?"
+        />
+        {error ? <p className="text-xs text-red-400">{error}</p> : null}
+        <div className="flex items-center justify-between pt-1">
+          <Button
+            type="button"
+            variant="ghost"
+            size="sm"
+            disabled={pending}
+            onClick={() => setMode("view")}
+          >
+            Cancel
+          </Button>
+          <Button
+            type="button"
+            size="sm"
+            variant="destructive"
+            disabled={pending}
+            onClick={handleConfirmReject}
+          >
+            {pending ? "Rejecting…" : "Confirm reject"}
+          </Button>
+        </div>
+      </GlassCard>
+    );
+  }
 
   return (
     <GlassCard className="flex flex-col p-5">
       <div className="flex items-start justify-between gap-3">
         <p className="font-display text-xl">{idea.hook}</p>
         {idea.format ? (
           <Badge variant="outline" className="shrink-0 border-white/15 text-white/50">
             {idea.format}
           </Badge>
         ) : null}
@@ -64,21 +143,27 @@ export function IdeaCard({
                   title={caption}
                 >
                   ↳ first-party: “{caption}”
                 </li>
               ))}
             </ul>
           ) : null}
         </div>
       ) : null}
 
-      <form action={formAction} className="mt-4 flex items-center gap-3">
-        <input type="hidden" name="workspaceId" value={workspaceId} />
-        <input type="hidden" name="ideaId" value={idea.id} />
-        <DraftButton drafted={idea.status === "drafted"} />
-        {state?.error ? (
-          <p className="text-xs text-red-400">{state.error}</p>
-        ) : null}
-      </form>
+      <div className="mt-4 flex items-center gap-2">
+        <StatusMenu
+          current={idea.status}
+          currentLabel={
+            pending ? "Working…" : IDEA_STATUS_LABELS[idea.status]
+          }
+          currentChipClass={IDEA_STATUS_CHIP_CLASSES[idea.status]}
+          options={statusOptions}
+          onSelect={handleStatusSelect}
+          disabled={pending}
+          label={idea.hook}
+        />
+        {error ? <p className="text-xs text-red-400">{error}</p> : null}
+      </div>
     </GlassCard>
   );
 }
diff --git a/src/app/(app)/w/[ws]/plan/page.tsx b/src/app/(app)/w/[ws]/plan/page.tsx
index d39474d..cc698ae 100644
--- a/src/app/(app)/w/[ws]/plan/page.tsx
+++ b/src/app/(app)/w/[ws]/plan/page.tsx
@@ -28,20 +28,23 @@ export default async function PlanPage({
     clientId: idea.clientId,
     clientName: idea.clientName,
     topic: idea.topic,
     hook: idea.hook,
     angle: idea.angle,
     format: idea.format,
     whyReason: idea.whyReason,
     citedCaptions: (idea.citations ?? [])
       .map((id) => captionById.get(id))
       .filter((c): c is string => Boolean(c)),
+    // listNewIdeas only ever returns status="new" rows — the query is
+    // filtered server-side, so this is never stale, just not re-selected.
+    status: "new",
   }));
 
   return (
     <div>
       <p className="label-mono text-brand-teal">Plan & Validate</p>
       <h1 className="mt-2 font-display text-4xl">Proposed slots</h1>
       <p className="mt-2 text-sm text-white/50">
         Every proposed slot cites baseline rows only — accept, edit, or
         reject with a reason.
       </p>
diff --git a/src/app/(app)/w/[ws]/plan/plan-card.tsx b/src/app/(app)/w/[ws]/plan/plan-card.tsx
index b44f7d8..c108f5b 100644
--- a/src/app/(app)/w/[ws]/plan/plan-card.tsx
+++ b/src/app/(app)/w/[ws]/plan/plan-card.tsx
@@ -1,47 +1,46 @@
 "use client";
 
-import { useEffect, useRef, useState } from "react";
+import { useEffect, useRef, useState, useTransition } from "react";
 import { useFormState, useFormStatus } from "react-dom";
 import { Badge } from "@/components/ui/badge";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { Textarea } from "@/components/ui/textarea";
 import { GlassCard } from "@/components/glass-card";
+import { StatusMenu, type TransitionOption } from "@/components/transition-menu";
+import {
+  IDEA_STATUS_CHIP_CLASSES,
+  IDEA_STATUS_LABELS,
+  nextIdeaStatusesFrom,
+  type IdeaStatus,
+} from "@/lib/idea-workflow";
 import {
   acceptIdeaAction,
   editIdeaAction,
   rejectIdeaAction,
   type PlanState,
 } from "./actions";
 
 export type PlanIdeaView = {
   id: string;
   clientId: string;
   clientName: string;
   topic: string;
   hook: string;
   angle: string | null;
   format: string | null;
   whyReason: string | null;
   citedCaptions: string[];
+  status: IdeaStatus;
 };
 
-function AcceptButton() {
-  const { pending } = useFormStatus();
-  return (
-    <Button type="submit" size="sm" disabled={pending}>
-      {pending ? "Accepting…" : "Accept"}
-    </Button>
-  );
-}
-
 function SaveButton() {
   const { pending } = useFormStatus();
   return (
     <Button type="submit" size="sm" disabled={pending}>
       {pending ? "Saving…" : "Save"}
     </Button>
   );
 }
 
 function ConfirmRejectButton() {
@@ -61,42 +60,70 @@ export function PlanCard({
   idea: PlanIdeaView;
 }) {
   const [mode, setMode] = useState<"view" | "editing" | "rejecting">("view");
   const [draft, setDraft] = useState({
     topic: idea.topic,
     hook: idea.hook,
     angle: idea.angle ?? "",
     format: idea.format ?? "",
   });
   const [reason, setReason] = useState("");
+  const [statusError, setStatusError] = useState<string | null>(null);
+  const [pending, startTransition] = useTransition();
 
-  const [acceptState, acceptAction] = useFormState<PlanState, FormData>(
-    acceptIdeaAction,
-    undefined,
-  );
   const [editState, editAction] = useFormState<PlanState, FormData>(
     editIdeaAction,
     undefined,
   );
   const [rejectState, rejectActionFn] = useFormState<PlanState, FormData>(
     rejectIdeaAction,
     undefined,
   );
 
   const lastEditState = useRef<PlanState>(undefined);
   useEffect(() => {
     if (editState !== lastEditState.current) {
       lastEditState.current = editState;
       if (!editState?.error) setMode("view");
     }
   }, [editState]);
 
+  const statusOptions: TransitionOption<IdeaStatus>[] = nextIdeaStatusesFrom(
+    idea.status,
+  ).map((option) => ({
+    value: option.status,
+    label: IDEA_STATUS_LABELS[option.status],
+    allowed: option.allowed,
+    reason: option.reason,
+    chipClass: IDEA_STATUS_CHIP_CLASSES[option.status],
+  }));
+
+  function handleStatusSelect(to: IdeaStatus) {
+    setStatusError(null);
+    if (to === "archived") {
+      setMode("rejecting");
+      return;
+    }
+    if (to === "drafted") {
+      const formData = new FormData();
+      formData.set("workspaceId", workspaceId);
+      formData.set("ideaId", idea.id);
+      // acceptIdeaAction triggers an AI draft generation that can take
+      // seconds — the status trigger must show a busy state for that whole
+      // window, not just fire-and-forget.
+      startTransition(async () => {
+        const result = await acceptIdeaAction(undefined, formData);
+        if (result?.error) setStatusError(result.error);
+      });
+    }
+  }
+
   if (mode === "editing") {
     return (
       <GlassCard className="space-y-3 p-5">
         <p className="label-mono text-white/40">Editing idea</p>
         <Input
           value={draft.topic}
           onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
           placeholder="Topic"
         />
         <Input
@@ -208,38 +235,35 @@ export function PlanCard({
                 >
                   ↳ first-party: “{caption}”
                 </li>
               ))}
             </ul>
           ) : null}
         </div>
       ) : null}
 
       <div className="mt-4 flex items-center gap-2">
-        <form action={acceptAction}>
-          <input type="hidden" name="workspaceId" value={workspaceId} />
-          <input type="hidden" name="ideaId" value={idea.id} />
-          <AcceptButton />
-        </form>
+        <StatusMenu
+          current={idea.status}
+          currentLabel={pending ? "Working…" : IDEA_STATUS_LABELS[idea.status]}
+          currentChipClass={IDEA_STATUS_CHIP_CLASSES[idea.status]}
+          options={statusOptions}
+          onSelect={handleStatusSelect}
+          disabled={pending}
+          label={idea.hook}
+        />
         <Button
           type="button"
           size="sm"
           variant="outline"
+          disabled={pending}
           onClick={() => setMode("editing")}
         >
           Edit
         </Button>
-        <Button
-          type="button"
-          size="sm"
-          variant="ghost"
-          onClick={() => setMode("rejecting")}
-        >
-          Reject
-        </Button>
-        {acceptState?.error ? (
-          <p className="text-xs text-red-400">{acceptState.error}</p>
+        {statusError ? (
+          <p className="text-xs text-red-400">{statusError}</p>
         ) : null}
       </div>
     </GlassCard>
   );
 }
diff --git a/src/components/transition-menu.tsx b/src/components/transition-menu.tsx
index d79a489..71ea01d 100644
--- a/src/components/transition-menu.tsx
+++ b/src/components/transition-menu.tsx
@@ -2,45 +2,70 @@
 
 import { useEffect, useRef, useState } from "react";
 import { cn } from "@/lib/utils";
 import { PRODUCTION_STAGE_COLORS } from "@/lib/colors";
 import {
   nextStagesFrom,
   PRODUCTION_STAGE_LABELS,
   type ProductionStage,
 } from "@/lib/production";
 
+/** One selectable destination in a status/stage menu. Fully resolved by the
+ * caller — no domain lookups happen inside the menu itself, so it stays
+ * reusable across production stages, idea statuses, or anything else with a
+ * small terminal-ish transition graph. `chipClass` must be a static,
+ * fully-written Tailwind class string (Tailwind JIT requirement). */
+export type TransitionOption<T extends string> = {
+  value: T;
+  label: string;
+  allowed: boolean;
+  /** Present whenever allowed is false — why this move isn't on the table. */
+  reason?: string;
+  chipClass: string;
+};
+
 /**
- * Jira-style inline status transition menu. Purely presentational: it knows
- * the transition graph (via nextStagesFrom) well enough to render every
- * stage colour-coded and disable the ones that aren't legal right now, but
- * it has no idea a server action exists. The caller wires onSelect to
- * whatever performs the move (a server action today, maybe an optimistic
- * store tomorrow) so this can be reused from the calendar, plan view, and
- * hub without dragging server-action imports along with it.
+ * Generic Jira-style inline status/stage transition menu. Purely
+ * presentational: it renders whatever options the caller hands it,
+ * colour-coded and disabled-with-reason where illegal, and has no idea a
+ * server action exists — the caller wires onSelect to whatever performs the
+ * move (a server action today, maybe an optimistic store tomorrow). That's
+ * what lets the same component back the Production board, Plan & Validate,
+ * and Ideation without dragging server-action imports along with it.
  *
  * Illegal destinations are rendered disabled with their reason rather than
  * omitted — a greyed transition teaches the workflow, a hidden one just
  * confuses.
  */
-export function TransitionMenu({
+export function StatusMenu<T extends string>({
   current,
+  currentLabel,
+  currentChipClass,
+  options,
   onSelect,
   disabled = false,
   label,
+  menuAriaLabel = "Move to status",
 }: {
-  current: ProductionStage;
-  onSelect: (stage: ProductionStage) => void;
+  current: T;
+  /** Display label for the trigger chip (current value). */
+  currentLabel: string;
+  /** Static Tailwind class string for the trigger chip. */
+  currentChipClass: string;
+  options: TransitionOption<T>[];
+  onSelect: (value: T) => void;
   /** Disables the trigger entirely, e.g. while a move is in flight. */
   disabled?: boolean;
   /** Optional context (e.g. card title) folded into the trigger's aria-label. */
   label?: string;
+  /** aria-label for the open menu, e.g. "Move to stage" vs "Move to status". */
+  menuAriaLabel?: string;
 }) {
   const [open, setOpen] = useState(false);
   const containerRef = useRef<HTMLDivElement>(null);
 
   useEffect(() => {
     if (!open) return;
 
     function handlePointerDown(event: MouseEvent) {
       if (
         containerRef.current &&
@@ -54,79 +79,120 @@ export function TransitionMenu({
     }
 
     document.addEventListener("mousedown", handlePointerDown);
     document.addEventListener("keydown", handleKeyDown);
     return () => {
       document.removeEventListener("mousedown", handlePointerDown);
       document.removeEventListener("keydown", handleKeyDown);
     };
   }, [open]);
 
-  const options = nextStagesFrom(current);
-  const currentColors = PRODUCTION_STAGE_COLORS[current];
-  const triggerLabel = `${label ? `${label} — ` : ""}stage: ${PRODUCTION_STAGE_LABELS[current]}. Click to change.`;
+  const triggerLabel = `${label ? `${label} — ` : ""}status: ${currentLabel}. Click to change.`;
 
   return (
     <div ref={containerRef} className="relative inline-block text-left">
       <button
         type="button"
         aria-label={triggerLabel}
         aria-haspopup="menu"
         aria-expanded={open}
         disabled={disabled}
+        data-current-value={current}
         onClick={() => setOpen((v) => !v)}
         className={cn(
           "rounded px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50",
-          currentColors.chip,
+          currentChipClass,
         )}
       >
-        {PRODUCTION_STAGE_LABELS[current]}
+        {currentLabel}
       </button>
 
       {open ? (
         <div
           role="menu"
-          aria-label="Move to stage"
+          aria-label={menuAriaLabel}
           className="absolute left-0 top-full z-20 mt-1 w-56 space-y-0.5 rounded-md border border-white/10 bg-slate-900/95 p-1.5 shadow-lg backdrop-blur"
         >
-          {options.map((option) => {
-            const colors = PRODUCTION_STAGE_COLORS[option.stage];
-            return (
-              <button
-                key={option.stage}
-                type="button"
-                role="menuitem"
-                disabled={!option.allowed}
-                aria-disabled={!option.allowed}
-                title={option.reason}
-                onClick={() => {
-                  if (!option.allowed) return;
-                  setOpen(false);
-                  onSelect(option.stage);
-                }}
+          {options.map((option) => (
+            <button
+              key={option.value}
+              type="button"
+              role="menuitem"
+              disabled={!option.allowed}
+              aria-disabled={!option.allowed}
+              title={option.reason}
+              onClick={() => {
+                if (!option.allowed) return;
+                setOpen(false);
+                onSelect(option.value);
+              }}
+              className={cn(
+                "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
+                "disabled:cursor-not-allowed disabled:opacity-40",
+                option.allowed && "hover:bg-white/10",
+              )}
+            >
+              <span
                 className={cn(
-                  "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
-                  "disabled:cursor-not-allowed disabled:opacity-40",
-                  option.allowed && "hover:bg-white/10",
+                  "rounded px-1.5 py-0.5 text-[11px] font-medium",
+                  option.chipClass,
                 )}
               >
-                <span
-                  className={cn(
-                    "rounded px-1.5 py-0.5 text-[11px] font-medium",
-                    colors.chip,
-                  )}
-                >
-                  {PRODUCTION_STAGE_LABELS[option.stage]}
+                {option.label}
+              </span>
+              {!option.allowed && option.reason ? (
+                <span className="px-1.5 text-[10px] text-white/40">
+                  {option.reason}
                 </span>
-                {!option.allowed && option.reason ? (
-                  <span className="px-1.5 text-[10px] text-white/40">
-                    {option.reason}
-                  </span>
-                ) : null}
-              </button>
-            );
-          })}
+              ) : null}
+            </button>
+          ))}
         </div>
       ) : null}
     </div>
   );
 }
+
+/**
+ * Production-stage-specific adapter, preserved byte-for-byte compatible
+ * with its U1 call site (production-card.tsx, owned by another slice and
+ * off-limits here): same props, same rendered output. It derives the
+ * generic StatusMenu's options/labels/colours from the production
+ * transition graph and delegates — the popover mechanics live in one place
+ * (StatusMenu) instead of being duplicated per surface.
+ */
+export function TransitionMenu({
+  current,
+  onSelect,
+  disabled = false,
+  label,
+}: {
+  current: ProductionStage;
+  onSelect: (stage: ProductionStage) => void;
+  /** Disables the trigger entirely, e.g. while a move is in flight. */
+  disabled?: boolean;
+  /** Optional context (e.g. card title) folded into the trigger's aria-label. */
+  label?: string;
+}) {
+  const options: TransitionOption<ProductionStage>[] = nextStagesFrom(
+    current,
+  ).map((option) => ({
+    value: option.stage,
+    label: PRODUCTION_STAGE_LABELS[option.stage],
+    allowed: option.allowed,
+    reason: option.reason,
+    chipClass: PRODUCTION_STAGE_COLORS[option.stage].chip,
+  }));
+
+  return (
+    <StatusMenu
+      current={current}
+      currentLabel={PRODUCTION_STAGE_LABELS[current]}
+      currentChipClass={PRODUCTION_STAGE_COLORS[current].chip}
+      options={options}
+      onSelect={onSelect}
+      disabled={disabled}
+      label={label}
+      menuAriaLabel="Move to stage"
+    />
+  );
+}
diff --git a/src/lib/idea-workflow.test.ts b/src/lib/idea-workflow.test.ts
new file mode 100644
index 0000000..54ab711
--- /dev/null
+++ b/src/lib/idea-workflow.test.ts
@@ -0,0 +1,116 @@
+import { describe, expect, it } from "vitest";
+import {
+  IDEA_STATUS_ORDER,
+  isValidIdeaTransition,
+  nextIdeaStatusesFrom,
+  transitionsForIdea,
+  type IdeaStatus,
+} from "./idea-workflow";
+
+describe("IDEA_STATUS_ORDER", () => {
+  it("matches the pgEnum order", () => {
+    expect(IDEA_STATUS_ORDER).toEqual(["new", "drafted", "archived"]);
+  });
+});
+
+describe("transitionsForIdea", () => {
+  it("new forks to drafted (accept) and archived (reject)", () => {
+    const transitions = transitionsForIdea("new");
+    expect(transitions).toHaveLength(2);
+    expect(transitions.map((t) => t.to).sort()).toEqual([
+      "archived",
+      "drafted",
+    ]);
+  });
+
+  it("drafted is terminal", () => {
+    expect(transitionsForIdea("drafted")).toEqual([]);
+  });
+
+  it("archived is terminal", () => {
+    expect(transitionsForIdea("archived")).toEqual([]);
+  });
+});
+
+describe("isValidIdeaTransition", () => {
+  it("allows accept and reject from new", () => {
+    expect(isValidIdeaTransition("new", "drafted")).toBe(true);
+    expect(isValidIdeaTransition("new", "archived")).toBe(true);
+  });
+
+  it("rejects any move out of a terminal status", () => {
+    expect(isValidIdeaTransition("drafted", "new")).toBe(false);
+    expect(isValidIdeaTransition("drafted", "archived")).toBe(false);
+    expect(isValidIdeaTransition("archived", "new")).toBe(false);
+    expect(isValidIdeaTransition("archived", "drafted")).toBe(false);
+  });
+
+  it("rejects a no-op move to the same status", () => {
+    expect(isValidIdeaTransition("new", "new")).toBe(false);
+    expect(isValidIdeaTransition("drafted", "drafted")).toBe(false);
+  });
+});
+
+describe("nextIdeaStatusesFrom", () => {
+  it("returns every status, never a subset", () => {
+    for (const status of IDEA_STATUS_ORDER) {
+      const options = nextIdeaStatusesFrom(status);
+      expect(options.map((o) => o.status)).toEqual(IDEA_STATUS_ORDER);
+    }
+  });
+
+  it("marks legal transitions from new allowed with no reason", () => {
+    const options = nextIdeaStatusesFrom("new");
+    const drafted = options.find((o) => o.status === "drafted");
+    const archived = options.find((o) => o.status === "archived");
+    expect(drafted?.allowed).toBe(true);
+    expect(drafted?.reason).toBeUndefined();
+    expect(archived?.allowed).toBe(true);
+    expect(archived?.reason).toBeUndefined();
+  });
+
+  it("marks the current status itself as disabled with a reason", () => {
+    const options = nextIdeaStatusesFrom("new");
+    const self = options.find((o) => o.status === "new");
+    expect(self?.allowed).toBe(false);
+    expect(self?.reason).toBeTruthy();
+  });
+
+  it("drafted is terminal — every option is disabled", () => {
+    const options = nextIdeaStatusesFrom("drafted");
+    expect(options.every((o) => !o.allowed)).toBe(true);
+  });
+
+  it("archived is terminal — every option is disabled", () => {
+    const options = nextIdeaStatusesFrom("archived");
+    expect(options.every((o) => !o.allowed)).toBe(true);
+  });
+
+  it("property: never marks a transition allowed that isValidIdeaTransition rejects, over every status pair", () => {
+    for (const from of IDEA_STATUS_ORDER) {
+      const options = nextIdeaStatusesFrom(from);
+      for (const option of options) {
+        const graphSaysLegal = isValidIdeaTransition(
+          from,
+          option.status as IdeaStatus,
+        );
+        if (option.allowed) {
+          expect(graphSaysLegal).toBe(true);
+        } else {
+          expect(graphSaysLegal).toBe(false);
+        }
+      }
+    }
+
+    // Exhaustive over every (from, to) pair, not just what nextIdeaStatusesFrom
+    // happens to enumerate — a stronger form of the same guarantee.
+    for (const from of IDEA_STATUS_ORDER) {
+      for (const to of IDEA_STATUS_ORDER) {
+        const options = nextIdeaStatusesFrom(from);
+        const option = options.find((o) => o.status === to);
+        expect(option).toBeDefined();
+        expect(option?.allowed).toBe(isValidIdeaTransition(from, to));
+      }
+    }
+  });
+});
diff --git a/src/lib/idea-workflow.ts b/src/lib/idea-workflow.ts
new file mode 100644
index 0000000..9ce6d84
--- /dev/null
+++ b/src/lib/idea-workflow.ts
@@ -0,0 +1,87 @@
+import { ideaStatus } from "@/db/schema";
+
+export type IdeaStatus = (typeof ideaStatus.enumValues)[number];
+
+/** Single source of truth for status order — derived from the pgEnum. */
+export const IDEA_STATUS_ORDER = ideaStatus.enumValues;
+
+export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
+  new: "New",
+  drafted: "Drafted",
+  archived: "Archived",
+};
+
+/**
+ * Static, fully-written Tailwind class strings (JIT scans source text, so
+ * nothing here may be template-built). Shared by the Ideation and Plan &
+ * Validate surfaces so the same status always reads the same colour.
+ */
+export const IDEA_STATUS_CHIP_CLASSES: Record<IdeaStatus, string> = {
+  new: "bg-sky-400/15 text-sky-300",
+  drafted: "bg-emerald-400/15 text-emerald-300",
+  archived: "bg-red-400/15 text-red-400",
+};
+
+export type IdeaTransition = {
+  to: IdeaStatus;
+  label: string;
+};
+
+/**
+ * A flat graph, not a line: "new" is the only decision point — it forks to
+ * "drafted" (accept) or "archived" (reject). Both destinations are terminal;
+ * neither surface lets you re-open a decided idea from this menu.
+ */
+const TRANSITIONS: Record<IdeaStatus, IdeaTransition[]> = {
+  new: [
+    { to: "drafted", label: "Accept" },
+    { to: "archived", label: "Reject" },
+  ],
+  drafted: [],
+  archived: [],
+};
+
+export function transitionsForIdea(status: IdeaStatus): IdeaTransition[] {
+  return TRANSITIONS[status];
+}
+
+export function isValidIdeaTransition(
+  from: IdeaStatus,
+  to: IdeaStatus,
+): boolean {
+  return TRANSITIONS[from].some((t) => t.to === to);
+}
+
+export type NextIdeaStatusOption = {
+  status: IdeaStatus;
+  allowed: boolean;
+  /** Present whenever allowed is false — why this move isn't on the table. */
+  reason?: string;
+};
+
+/**
+ * Every idea status, flagged for whether `current` can legally move to it
+ * right now. Backs the Jira-style status menu on Ideation and Plan &
+ * Validate: illegal destinations are never omitted, they're returned
+ * disabled with a short reason — a greyed transition teaches the workflow
+ * ("drafted is a terminal status"), a hidden one just confuses. `allowed` is
+ * always derived from isValidIdeaTransition, so this can never offer a move
+ * the transition graph rejects.
+ */
+export function nextIdeaStatusesFrom(
+  current: IdeaStatus,
+): NextIdeaStatusOption[] {
+  return IDEA_STATUS_ORDER.map((status) => {
+    if (status === current) {
+      return { status, allowed: false, reason: "this is the current status" };
+    }
+    if (isValidIdeaTransition(current, status)) {
+      return { status, allowed: true };
+    }
+    return {
+      status,
+      allowed: false,
+      reason: `not reachable from ${IDEA_STATUS_LABELS[current].toLowerCase()}`,
+    };
+  });
+}
