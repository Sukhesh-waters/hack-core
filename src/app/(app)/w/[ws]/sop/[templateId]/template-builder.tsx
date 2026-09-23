"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass-card";
import type { SopStepRow, SopTemplateRow } from "@/db/queries/sop";
import {
  SOP_CREATES_META,
  SOP_GATE_META,
  SOP_STEP_CREATES,
  SOP_STEP_GATES,
  formatOffset,
  shortOffset,
} from "@/lib/sop/template";
import {
  addStepAction,
  deleteStepAction,
  moveStepAction,
  updateStepAction,
  type SopActionState,
} from "../actions";

export type MemberOption = { userId: string; label: string };

/** Static, fully-written class strings — Tailwind's JIT scans source text,
 *  so a gate colour may never be built by interpolation. */
const GATE_CHIP: Record<string, string> = {
  none: "border-border text-muted-foreground/70",
  approval: "border-brand-purple/40 text-brand-purple",
  compliance: "border-brand-teal/40 text-brand-teal",
};

function PendingButton({
  label,
  pending: pendingLabel,
  variant = "default",
  size = "sm",
}: {
  label: string;
  pending: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "sm" | "default";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function TemplateBuilder({
  workspaceId,
  template,
  steps,
  canEdit,
  members,
  showHeader = true,
}: {
  workspaceId: string;
  template: SopTemplateRow;
  steps: SopStepRow[];
  canEdit: boolean;
  members: MemberOption[];
  showHeader?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      {showHeader ? (
        <>
          <p className="label-mono mt-4 text-brand-teal">SOP template</p>
          <h1 className="mt-2 font-display text-4xl">{template.name}</h1>
          {template.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {template.description}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground/70">
            Every step is dated relative to{" "}
            <span className="text-muted-foreground">{template.anchorLabel}</span>.
          </p>
        </>
      ) : null}

      <div className={showHeader ? "mt-6 space-y-3" : "mt-6 space-y-3"}>
        {steps.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="font-display text-xl">No steps yet</p>
            <p className="mt-2 text-sm text-muted-foreground/70">
              A template with no steps can&apos;t produce a run. Add the first
              one below.
            </p>
          </GlassCard>
        ) : (
          steps.map((step, index) =>
            editingId === step.id ? (
              <StepForm
                key={step.id}
                workspaceId={workspaceId}
                templateId={template.id}
                step={step}
                siblings={steps.filter((s) => s.id !== step.id)}
                members={members}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <StepRow
                key={step.id}
                workspaceId={workspaceId}
                templateId={template.id}
                step={step}
                steps={steps}
                index={index}
                total={steps.length}
                members={members}
                canEdit={canEdit}
                onEdit={() => setEditingId(step.id)}
              />
            ),
          )
        )}
      </div>

      {canEdit ? (
        <GlassCard className="mt-6 p-5">
          <p className="label-mono text-muted-foreground/70">Add a step</p>
          <div className="mt-3">
            <StepForm
              workspaceId={workspaceId}
              templateId={template.id}
              step={null}
              siblings={steps}
              members={members}
            />
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}

function StepRow({
  workspaceId,
  templateId,
  step,
  steps,
  index,
  total,
  members,
  canEdit,
  onEdit,
}: {
  workspaceId: string;
  templateId: string;
  step: SopStepRow;
  steps: SopStepRow[];
  index: number;
  total: number;
  members: MemberOption[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const [deleteState, deleteAction] = useActionState<SopActionState, FormData>(
    deleteStepAction,
    undefined,
  );
  const [moveState, moveAction] = useActionState<SopActionState, FormData>(
    moveStepAction,
    undefined,
  );

  const titleById = new Map(steps.map((s) => [s.id, s.title]));
  const blockers = step.dependsOn
    .map((id) => titleById.get(id))
    .filter((t): t is string => Boolean(t));

  // Bound to a local so the discriminated union narrows — reading
  // step.assigneeRule.value off the property chain doesn't.
  const rule = step.assigneeRule;
  const owner =
    rule.kind === "user"
      ? (members.find((m) => m.userId === rule.value)?.label ??
        "Unknown member")
      : rule.kind === "role"
        ? `Any ${rule.value}`
        : "Unassigned";

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {shortOffset(step.dueOffsetDays)}
            </span>
            <p className="font-display text-lg">{step.title}</p>
          </div>
          {step.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/70">
            <span>{formatOffset(step.dueOffsetDays)}</span>
            <span aria-hidden="true">·</span>
            <span>{owner}</span>
            {step.creates !== "none" ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Creates {SOP_CREATES_META[step.creates].label}</span>
              </>
            ) : null}
          </div>
          {blockers.length > 0 ? (
            <p className="mt-2 text-xs text-amber-300/80">
              Waits on: {blockers.join(", ")}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant="outline" className={GATE_CHIP[step.gate]}>
            {SOP_GATE_META[step.gate].label}
          </Badge>
          {canEdit ? (
            <div className="flex items-center gap-1">
              <form action={moveAction}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="templateId" value={templateId} />
                <input type="hidden" name="stepId" value={step.id} />
                <input type="hidden" name="direction" value="up" />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move ${step.title} earlier`}
                >
                  ↑
                </Button>
              </form>
              <form action={moveAction}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="templateId" value={templateId} />
                <input type="hidden" name="stepId" value={step.id} />
                <input type="hidden" name="direction" value="down" />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  disabled={index === total - 1}
                  aria-label={`Move ${step.title} later`}
                >
                  ↓
                </Button>
              </form>
              <Button type="button" size="sm" variant="outline" onClick={onEdit}>
                Edit
              </Button>
              <form action={deleteAction}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="templateId" value={templateId} />
                <input type="hidden" name="stepId" value={step.id} />
                <PendingButton
                  label="Delete"
                  pending="Deleting…"
                  variant="ghost"
                />
              </form>
            </div>
          ) : null}
        </div>
      </div>
      {deleteState?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {deleteState.error}
        </p>
      ) : null}
      {moveState?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {moveState.error}
        </p>
      ) : null}
    </GlassCard>
  );
}

/** One form for both add and edit — the fields are identical, and keeping
 *  them as one component is what stops the two drifting apart. */
function StepForm({
  workspaceId,
  templateId,
  step,
  siblings,
  members,
  onDone,
}: {
  workspaceId: string;
  templateId: string;
  step: SopStepRow | null;
  siblings: SopStepRow[];
  members: MemberOption[];
  onDone?: () => void;
}) {
  const isEdit = step !== null;
  const [state, formAction] = useActionState<SopActionState, FormData>(
    isEdit ? updateStepAction : addStepAction,
    undefined,
  );
  const [assigneeKind, setAssigneeKind] = useState<string>(
    step?.assigneeRule.kind ?? "unassigned",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedAt = useRef<number | undefined>(undefined);

  /**
   * On a successful save: an edit closes itself, and the add form clears.
   *
   * The clear is the important half. These are uncontrolled inputs, so
   * without an explicit reset the DOM keeps whatever was last typed — and
   * because a revalidate re-renders rather than remounts, the next step
   * silently inherits the previous one's gate, offset and dependencies.
   */
  useEffect(() => {
    if (!state?.savedAt || state.savedAt === lastSavedAt.current) return;
    lastSavedAt.current = state.savedAt;
    if (isEdit) {
      onDone?.();
      return;
    }
    formRef.current?.reset();
    setAssigneeKind("unassigned");
  }, [state?.savedAt, isEdit, onDone]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="templateId" value={templateId} />
      {isEdit ? (
        <input type="hidden" name="stepId" value={step.id} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Title *
          </span>
          <Input
            name="title"
            required
            maxLength={120}
            defaultValue={step?.title ?? ""}
            placeholder="Brief approved"
            className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Days from anchor
          </span>
          <Input
            name="dueOffsetDays"
            type="number"
            step={1}
            min={-365}
            max={365}
            defaultValue={step?.dueOffsetDays ?? 0}
            className="mt-1 w-32 border-border bg-muted text-foreground"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground/50">
            Negative = before
          </span>
        </label>
      </div>

      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Description
        </span>
        <Input
          name="description"
          maxLength={1000}
          defaultValue={step?.description ?? ""}
          placeholder="What this step involves"
          className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Owner
          </span>
          <select
            name="assigneeKind"
            value={assigneeKind}
            onChange={(e) => setAssigneeKind(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          >
            <option value="unassigned" className="bg-popover">
              Unassigned
            </option>
            <option value="role" className="bg-popover">
              By role
            </option>
            <option value="user" className="bg-popover">
              A specific person
            </option>
          </select>
        </label>

        {assigneeKind === "role" ? (
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
              Role
            </span>
            <select
              name="assigneeRole"
              defaultValue={
                step?.assigneeRule.kind === "role"
                  ? step.assigneeRule.value
                  : "member"
              }
              className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
            >
              <option value="owner" className="bg-popover">
                Owner
              </option>
              <option value="admin" className="bg-popover">
                Admin
              </option>
              <option value="member" className="bg-popover">
                Member
              </option>
            </select>
          </label>
        ) : null}

        {assigneeKind === "user" ? (
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
              Person
            </span>
            <select
              name="assigneeUserId"
              defaultValue={
                step?.assigneeRule.kind === "user"
                  ? step.assigneeRule.value
                  : ""
              }
              className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
            >
              <option value="" className="bg-popover">
                Pick someone
              </option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId} className="bg-popover">
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Gate
          </span>
          <select
            name="gate"
            defaultValue={step?.gate ?? "none"}
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          >
            {SOP_STEP_GATES.map((g) => (
              <option key={g} value={g} className="bg-popover">
                {SOP_GATE_META[g].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Creates
          </span>
          <select
            name="creates"
            defaultValue={step?.creates ?? "none"}
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          >
            {SOP_STEP_CREATES.map((c) => (
              <option key={c} value={c} className="bg-popover">
                {SOP_CREATES_META[c].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {siblings.length > 0 ? (
        <fieldset>
          <legend className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Waits on
          </legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {siblings.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <input
                  type="checkbox"
                  name="dependsOn"
                  value={s.id}
                  defaultChecked={step?.dependsOn.includes(s.id) ?? false}
                  className="rounded border-border bg-transparent"
                />
                <span className="font-mono text-[11px] text-muted-foreground/70">
                  {shortOffset(s.dueOffsetDays)}
                </span>
                {s.title}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {state?.error ? (
        <p className="text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <PendingButton
          label={isEdit ? "Save step" : "Add step"}
          pending={isEdit ? "Saving…" : "Adding…"}
        />
        {onDone ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
