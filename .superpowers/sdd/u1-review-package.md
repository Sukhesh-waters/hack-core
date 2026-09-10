# U1 review package

## Commits
df46ef7 feat(production): Jira-style inline status transition menu

## Stat
 .../(app)/w/[ws]/production/production-card.tsx    |  92 +++++---------
 src/components/transition-menu.tsx                 | 132 +++++++++++++++++++++
 src/lib/production.test.ts                         |  60 ++++++++++
 src/lib/production.ts                              |  32 +++++
 4 files changed, 254 insertions(+), 62 deletions(-)

## Diff
diff --git a/src/app/(app)/w/[ws]/production/production-card.tsx b/src/app/(app)/w/[ws]/production/production-card.tsx
index 5627bd9..fe08efa 100644
--- a/src/app/(app)/w/[ws]/production/production-card.tsx
+++ b/src/app/(app)/w/[ws]/production/production-card.tsx
@@ -1,86 +1,57 @@
 "use client";
 
-import { useFormState, useFormStatus } from "react-dom";
+import { useState, useTransition } from "react";
 import { Badge } from "@/components/ui/badge";
-import { Button } from "@/components/ui/button";
 import { GlassCard } from "@/components/glass-card";
+import { TransitionMenu } from "@/components/transition-menu";
 import { cn } from "@/lib/utils";
 import {
   clientColor,
   CONTENT_TYPE_COLORS,
   type ContentType,
 } from "@/lib/colors";
-import { transitionsFor, type ProductionStage } from "@/lib/production";
-import {
-  advanceProductionStageAction,
-  type ProductionState,
-} from "./actions";
+import type { ProductionStage } from "@/lib/production";
+import { advanceProductionStageAction } from "./actions";
 
 export type ProductionCardView = {
   id: string;
   clientId: string;
   clientName: string;
   title: string;
   type: ContentType;
   productionStage: ProductionStage;
   revisionCount: number;
 };
 
-function AdvanceButton({ label }: { label: string }) {
-  const { pending } = useFormStatus();
-  return (
-    <Button type="submit" size="sm" variant="outline" disabled={pending}>
-      {pending ? "…" : label}
-    </Button>
-  );
-}
-
-function TransitionForm({
-  workspaceId,
-  contentId,
-  from,
-  to,
-  label,
-}: {
-  workspaceId: string;
-  contentId: string;
-  from: ProductionStage;
-  to: ProductionStage;
-  label: string;
-}) {
-  const [state, formAction] = useFormState<ProductionState, FormData>(
-    advanceProductionStageAction,
-    undefined,
-  );
-  return (
-    <form action={formAction} className="inline">
-      <input type="hidden" name="workspaceId" value={workspaceId} />
-      <input type="hidden" name="contentId" value={contentId} />
-      <input type="hidden" name="from" value={from} />
-      <input type="hidden" name="to" value={to} />
-      <AdvanceButton label={label} />
-      {state?.error ? (
-        <p className="mt-1 text-xs text-red-400">{state.error}</p>
-      ) : null}
-    </form>
-  );
-}
-
 export function ProductionCard({
   workspaceId,
   card,
 }: {
   workspaceId: string;
   card: ProductionCardView;
 }) {
-  const transitions = transitionsFor(card.productionStage);
+  const [error, setError] = useState<string | null>(null);
+  const [pending, startTransition] = useTransition();
+
+  function handleSelect(to: ProductionStage) {
+    setError(null);
+    const formData = new FormData();
+    formData.set("workspaceId", workspaceId);
+    formData.set("contentId", card.id);
+    formData.set("from", card.productionStage);
+    formData.set("to", to);
+    startTransition(async () => {
+      const result = await advanceProductionStageAction(undefined, formData);
+      if (result?.error) setError(result.error);
+    });
+  }
 
   return (
     <GlassCard className="space-y-3 p-4">
       <div>
         <p className="text-sm text-white/85">{card.title}</p>
         <div className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
           <span
             className={cn(
               "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
               clientColor(card.clientId).dot,
@@ -100,27 +71,24 @@ export function ProductionCard({
       {card.revisionCount > 0 ? (
         <div className="flex flex-wrap items-center gap-2">
           <Badge
             variant="outline"
             className="border-brand-amber/40 text-brand-amber"
           >
             Revised ×{card.revisionCount}
           </Badge>
         </div>
       ) : null}
-      {transitions.length > 0 ? (
-        <div className="flex flex-wrap gap-2">
-          {transitions.map((t) => (
-            <TransitionForm
-              key={t.to}
-              workspaceId={workspaceId}
-              contentId={card.id}
-              from={card.productionStage}
-              to={t.to}
-              label={t.label}
-            />
-          ))}
-        </div>
-      ) : null}
+      <div>
+        <TransitionMenu
+          current={card.productionStage}
+          onSelect={handleSelect}
+          disabled={pending}
+          label={card.title}
+        />
+        {error ? (
+          <p className="mt-1 text-xs text-red-400">{error}</p>
+        ) : null}
+      </div>
     </GlassCard>
   );
 }
diff --git a/src/components/transition-menu.tsx b/src/components/transition-menu.tsx
new file mode 100644
index 0000000..d79a489
--- /dev/null
+++ b/src/components/transition-menu.tsx
@@ -0,0 +1,132 @@
+"use client";
+
+import { useEffect, useRef, useState } from "react";
+import { cn } from "@/lib/utils";
+import { PRODUCTION_STAGE_COLORS } from "@/lib/colors";
+import {
+  nextStagesFrom,
+  PRODUCTION_STAGE_LABELS,
+  type ProductionStage,
+} from "@/lib/production";
+
+/**
+ * Jira-style inline status transition menu. Purely presentational: it knows
+ * the transition graph (via nextStagesFrom) well enough to render every
+ * stage colour-coded and disable the ones that aren't legal right now, but
+ * it has no idea a server action exists. The caller wires onSelect to
+ * whatever performs the move (a server action today, maybe an optimistic
+ * store tomorrow) so this can be reused from the calendar, plan view, and
+ * hub without dragging server-action imports along with it.
+ *
+ * Illegal destinations are rendered disabled with their reason rather than
+ * omitted — a greyed transition teaches the workflow, a hidden one just
+ * confuses.
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
+  const [open, setOpen] = useState(false);
+  const containerRef = useRef<HTMLDivElement>(null);
+
+  useEffect(() => {
+    if (!open) return;
+
+    function handlePointerDown(event: MouseEvent) {
+      if (
+        containerRef.current &&
+        !containerRef.current.contains(event.target as Node)
+      ) {
+        setOpen(false);
+      }
+    }
+    function handleKeyDown(event: KeyboardEvent) {
+      if (event.key === "Escape") setOpen(false);
+    }
+
+    document.addEventListener("mousedown", handlePointerDown);
+    document.addEventListener("keydown", handleKeyDown);
+    return () => {
+      document.removeEventListener("mousedown", handlePointerDown);
+      document.removeEventListener("keydown", handleKeyDown);
+    };
+  }, [open]);
+
+  const options = nextStagesFrom(current);
+  const currentColors = PRODUCTION_STAGE_COLORS[current];
+  const triggerLabel = `${label ? `${label} — ` : ""}stage: ${PRODUCTION_STAGE_LABELS[current]}. Click to change.`;
+
+  return (
+    <div ref={containerRef} className="relative inline-block text-left">
+      <button
+        type="button"
+        aria-label={triggerLabel}
+        aria-haspopup="menu"
+        aria-expanded={open}
+        disabled={disabled}
+        onClick={() => setOpen((v) => !v)}
+        className={cn(
+          "rounded px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50",
+          currentColors.chip,
+        )}
+      >
+        {PRODUCTION_STAGE_LABELS[current]}
+      </button>
+
+      {open ? (
+        <div
+          role="menu"
+          aria-label="Move to stage"
+          className="absolute left-0 top-full z-20 mt-1 w-56 space-y-0.5 rounded-md border border-white/10 bg-slate-900/95 p-1.5 shadow-lg backdrop-blur"
+        >
+          {options.map((option) => {
+            const colors = PRODUCTION_STAGE_COLORS[option.stage];
+            return (
+              <button
+                key={option.stage}
+                type="button"
+                role="menuitem"
+                disabled={!option.allowed}
+                aria-disabled={!option.allowed}
+                title={option.reason}
+                onClick={() => {
+                  if (!option.allowed) return;
+                  setOpen(false);
+                  onSelect(option.stage);
+                }}
+                className={cn(
+                  "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
+                  "disabled:cursor-not-allowed disabled:opacity-40",
+                  option.allowed && "hover:bg-white/10",
+                )}
+              >
+                <span
+                  className={cn(
+                    "rounded px-1.5 py-0.5 text-[11px] font-medium",
+                    colors.chip,
+                  )}
+                >
+                  {PRODUCTION_STAGE_LABELS[option.stage]}
+                </span>
+                {!option.allowed && option.reason ? (
+                  <span className="px-1.5 text-[10px] text-white/40">
+                    {option.reason}
+                  </span>
+                ) : null}
+              </button>
+            );
+          })}
+        </div>
+      ) : null}
+    </div>
+  );
+}
diff --git a/src/lib/production.test.ts b/src/lib/production.test.ts
index 1f46217..03dd408 100644
--- a/src/lib/production.test.ts
+++ b/src/lib/production.test.ts
@@ -1,15 +1,17 @@
 import { describe, expect, it } from "vitest";
 import {
   isValidTransition,
+  nextStagesFrom,
   PRODUCTION_STAGE_ORDER,
   transitionsFor,
+  type ProductionStage,
 } from "./production";
 
 describe("PRODUCTION_STAGE_ORDER", () => {
   it("matches the spec column order", () => {
     expect(PRODUCTION_STAGE_ORDER).toEqual([
       "brief",
       "in_progress",
       "internal_review",
       "revision",
       "done",
@@ -53,10 +55,68 @@ describe("isValidTransition", () => {
   it("rejects skipping stages", () => {
     expect(isValidTransition("brief", "done")).toBe(false);
     expect(isValidTransition("brief", "internal_review")).toBe(false);
   });
 
   it("rejects moving backward except the revision loop", () => {
     expect(isValidTransition("in_progress", "brief")).toBe(false);
     expect(isValidTransition("done", "internal_review")).toBe(false);
   });
 });
+
+describe("nextStagesFrom", () => {
+  it("returns every stage, never a subset", () => {
+    for (const stage of PRODUCTION_STAGE_ORDER) {
+      const options = nextStagesFrom(stage);
+      expect(options.map((o) => o.stage)).toEqual(PRODUCTION_STAGE_ORDER);
+    }
+  });
+
+  it("marks legal transitions allowed with no reason", () => {
+    const options = nextStagesFrom("internal_review");
+    const done = options.find((o) => o.stage === "done");
+    const revision = options.find((o) => o.stage === "revision");
+    expect(done?.allowed).toBe(true);
+    expect(done?.reason).toBeUndefined();
+    expect(revision?.allowed).toBe(true);
+    expect(revision?.reason).toBeUndefined();
+  });
+
+  it("marks illegal transitions disabled with a human reason", () => {
+    const options = nextStagesFrom("in_progress");
+    const brief = options.find((o) => o.stage === "brief");
+    const done = options.find((o) => o.stage === "done");
+    expect(brief?.allowed).toBe(false);
+    expect(brief?.reason).toMatch(/not reachable from in progress/i);
+    expect(done?.allowed).toBe(false);
+    expect(done?.reason).toMatch(/not reachable from in progress/i);
+  });
+
+  it("marks the current stage itself as disabled with a reason", () => {
+    const options = nextStagesFrom("revision");
+    const self = options.find((o) => o.stage === "revision");
+    expect(self?.allowed).toBe(false);
+    expect(self?.reason).toBeTruthy();
+  });
+
+  it("done is terminal — every option is disabled", () => {
+    const options = nextStagesFrom("done");
+    expect(options.every((o) => !o.allowed)).toBe(true);
+  });
+
+  it("property: never marks a transition allowed that isValidTransition rejects", () => {
+    for (const from of PRODUCTION_STAGE_ORDER) {
+      const options = nextStagesFrom(from);
+      for (const option of options) {
+        const graphSaysLegal = isValidTransition(
+          from,
+          option.stage as ProductionStage,
+        );
+        if (option.allowed) {
+          expect(graphSaysLegal).toBe(true);
+        } else {
+          expect(graphSaysLegal).toBe(false);
+        }
+      }
+    }
+  });
+});
diff --git a/src/lib/production.ts b/src/lib/production.ts
index b2c5d98..5987904 100644
--- a/src/lib/production.ts
+++ b/src/lib/production.ts
@@ -50,10 +50,42 @@ const TRANSITIONS: Record<ProductionStage, StageTransition[]> = {
 export function transitionsFor(stage: ProductionStage): StageTransition[] {
   return TRANSITIONS[stage];
 }
 
 export function isValidTransition(
   from: ProductionStage,
   to: ProductionStage,
 ): boolean {
   return TRANSITIONS[from].some((t) => t.to === to);
 }
+
+export type NextStageOption = {
+  stage: ProductionStage;
+  allowed: boolean;
+  /** Present whenever allowed is false — why this move isn't on the table. */
+  reason?: string;
+};
+
+/**
+ * Every stage, flagged for whether `current` can legally move to it right
+ * now. Backs the Jira-style status menu: a workflow dropdown must not be a
+ * free-form setter, so illegal destinations are never omitted — they're
+ * returned disabled with a short reason. A greyed-out transition teaches the
+ * workflow ("revision only resubmits to internal review"); a hidden one just
+ * confuses. `allowed` is always derived from isValidTransition, so this can
+ * never offer a move the transition graph rejects.
+ */
+export function nextStagesFrom(current: ProductionStage): NextStageOption[] {
+  return PRODUCTION_STAGE_ORDER.map((stage) => {
+    if (stage === current) {
+      return { stage, allowed: false, reason: "this is the current stage" };
+    }
+    if (isValidTransition(current, stage)) {
+      return { stage, allowed: true };
+    }
+    return {
+      stage,
+      allowed: false,
+      reason: `not reachable from ${PRODUCTION_STAGE_LABELS[current].toLowerCase()}`,
+    };
+  });
+}
