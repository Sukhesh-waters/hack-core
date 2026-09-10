"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import type { WorkflowRule } from "@/db/schema";
import { CAPABILITIES, CAPABILITY_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { WORKFLOW_STATE_COLORS, workflowColor } from "@/lib/workflow/defaults";
import {
  CONDITION_KINDS,
  CONDITION_META,
  POST_ACTION_KINDS,
  POST_ACTION_META,
  VALIDATOR_KINDS,
  VALIDATOR_META,
  type WorkflowRuleCategory,
} from "@/lib/workflow/rules";
import {
  addRuleAction,
  addStateAction,
  addTransitionAction,
  deleteStateAction,
  deleteTransitionAction,
  moveStateAction,
  removeRuleAction,
  renameStateAction,
  type WorkflowAdminState,
} from "./actions";

export type AdminStateView = {
  id: string;
  key: string;
  name: string;
  category: "todo" | "doing" | "done";
  colorKey: string;
  position: number;
  wipLimit: number | null;
  /** Seeded states mirror a production_stage; custom ones don't. Shown so
   *  an admin can see which states the legacy column still tracks. */
  isSeeded: boolean;
  cardCount: number;
};

export type AdminTransitionView = {
  id: string;
  fromStateId: string | null;
  toStateId: string;
  name: string;
  conditions: WorkflowRule[];
  validators: WorkflowRule[];
  postActions: WorkflowRule[];
};

const RULE_META: Record<WorkflowRuleCategory, Record<string, { label: string; hint: string }>> = {
  condition: CONDITION_META,
  validator: VALIDATOR_META,
  postAction: POST_ACTION_META,
};

const RULE_KINDS: Record<WorkflowRuleCategory, readonly string[]> = {
  condition: CONDITION_KINDS,
  validator: VALIDATOR_KINDS,
  postAction: POST_ACTION_KINDS,
};

const CATEGORY_LABEL: Record<WorkflowRuleCategory, string> = {
  condition: "Condition — who may attempt this move",
  validator: "Validator — what must be true of the card",
  postAction: "Post-action — what happens after the move",
};

/** One attached rule, with its remove control. Config isn't re-derived from
 *  the kind's meta since the two field lists diverge only in what an admin
 *  chose (capability, message, days) — the meta covers the general hint. */
function RuleChip({
  workspaceId,
  transitionId,
  category,
  rule,
  index,
  canEdit,
}: {
  workspaceId: string;
  transitionId: string;
  category: WorkflowRuleCategory;
  rule: WorkflowRule;
  index: number;
  canEdit: boolean;
}) {
  const [remove, removeFn] = useFormState(removeRuleAction, undefined);
  const meta = RULE_META[category][rule.kind];
  const detail =
    rule.kind === "requires_capability"
      ? String(rule.config.capability ?? "")
      : rule.kind === "set_due_offset"
        ? `${rule.config.days ?? 0}d`
        : rule.kind === "notify_assignee" && rule.config.message
          ? String(rule.config.message)
          : null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
      {meta?.label ?? rule.kind}
      {detail ? <span className="text-muted-foreground/70">· {detail}</span> : null}
      {canEdit ? (
        <form action={removeFn} className="contents">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="transitionId" value={transitionId} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="index" value={index} />
          <button
            type="submit"
            aria-label={`Remove ${meta?.label ?? rule.kind}`}
            className="text-muted-foreground/50 hover:text-destructive"
          >
            ×
          </button>
        </form>
      ) : null}
      <Err state={remove} />
    </span>
  );
}

/** Attaches one rule to one category on one transition. All three
 *  kind-specific fields render together — only the ones the chosen kind's
 *  schema reads are ever sent, the rest are simply ignored server-side. */
function AddRuleForm({
  workspaceId,
  transitionId,
  category,
}: {
  workspaceId: string;
  transitionId: string;
  category: WorkflowRuleCategory;
}) {
  const [add, addFn] = useFormState(addRuleAction, undefined);
  const kinds = RULE_KINDS[category];

  return (
    <form action={addFn} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="transitionId" value={transitionId} />
      <input type="hidden" name="category" value={category} />
      <label className="text-[11px] text-muted-foreground/70">
        Rule
        <select
          name="kind"
          className="ml-1.5 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground"
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind} className="bg-popover">
              {RULE_META[category][kind]?.label ?? kind}
            </option>
          ))}
        </select>
      </label>
      {category === "condition" ? (
        <label className="text-[11px] text-muted-foreground/70">
          Capability
          <select
            name="capability"
            className="ml-1.5 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground"
          >
            {CAPABILITIES.map((c) => (
              <option key={c} value={c} className="bg-popover">
                {CAPABILITY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {category === "postAction" ? (
        <>
          <label className="text-[11px] text-muted-foreground/70">
            Message
            <input
              name="message"
              placeholder="optional"
              maxLength={200}
              className="ml-1.5 w-40 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="text-[11px] text-muted-foreground/70">
            Days
            <input
              name="days"
              type="number"
              min={0}
              max={365}
              placeholder="0"
              className="ml-1.5 w-16 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground"
            />
          </label>
        </>
      ) : null}
      <Submit label="Attach" pending="Attaching…" />
      <Err state={add} />
    </form>
  );
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={busy}>
      {busy ? pending : label}
    </Button>
  );
}

function Err({ state }: { state: WorkflowAdminState }) {
  return state?.error ? (
    <p className="mt-1 text-xs text-destructive" role="alert">
      {state.error}
    </p>
  ) : null;
}

function StateRow({
  workspaceId,
  state,
  index,
  total,
  canEdit,
}: {
  workspaceId: string;
  state: AdminStateView;
  index: number;
  total: number;
  canEdit: boolean;
}) {
  const [rename, renameFn] = useFormState(renameStateAction, undefined);
  const [remove, removeFn] = useFormState(deleteStateAction, undefined);
  const [move, moveFn] = useFormState(moveStateAction, undefined);

  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-block size-2 shrink-0 rounded-full",
            workflowColor(state.colorKey).dot,
          )}
        />
        <span
          className={cn(
            "rounded px-2 py-0.5 text-xs",
            workflowColor(state.colorKey).chip,
          )}
        >
          {state.name}
        </span>
        <Badge
          variant="outline"
          className="border-border text-[11px] text-muted-foreground/70"
        >
          {state.category}
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground/50">{state.key}</span>
        <span className="text-xs text-muted-foreground/70">
          {state.cardCount} card{state.cardCount === 1 ? "" : "s"}
        </span>
        {state.wipLimit !== null ? (
          <span className="text-xs text-muted-foreground/70">WIP {state.wipLimit}</span>
        ) : null}
        {!state.isSeeded ? (
          <Badge
            variant="outline"
            className="border-violet-400/30 text-[11px] text-violet-300"
          >
            custom
          </Badge>
        ) : null}

        {canEdit ? (
          <span className="ml-auto flex items-center gap-1">
            <form action={moveFn} className="contents">
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="stateId" value={state.id} />
              <button
                type="submit"
                name="direction"
                value="left"
                disabled={index === 0}
                aria-label={`Move ${state.name} earlier`}
                className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-foreground disabled:opacity-25"
              >
                ←
              </button>
              <button
                type="submit"
                name="direction"
                value="right"
                disabled={index === total - 1}
                aria-label={`Move ${state.name} later`}
                className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-foreground disabled:opacity-25"
              >
                →
              </button>
            </form>
            <form action={removeFn}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="stateId" value={state.id} />
              <button
                type="submit"
                aria-label={`Delete ${state.name}`}
                className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-destructive"
              >
                Delete
              </button>
            </form>
          </span>
        ) : null}
      </div>

      {canEdit ? (
        <form action={renameFn} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="stateId" value={state.id} />
          <label className="text-xs text-muted-foreground/70">
            Name
            <input
              name="name"
              defaultValue={state.name}
              maxLength={40}
              className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground/70">
            WIP limit
            <input
              name="wipLimit"
              type="number"
              min={0}
              max={999}
              defaultValue={state.wipLimit ?? ""}
              placeholder="none"
              className="ml-2 w-24 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
            />
          </label>
          <Submit label="Save" pending="Saving…" />
        </form>
      ) : null}

      <Err state={rename} />
      <Err state={remove} />
      <Err state={move} />
    </GlassCard>
  );
}

function TransitionRow({
  workspaceId,
  transition,
  fromName,
  toName,
  canEdit,
}: {
  workspaceId: string;
  transition: AdminTransitionView;
  fromName: string;
  toName: string;
  canEdit: boolean;
}) {
  const [remove, removeFn] = useFormState(deleteTransitionAction, undefined);
  const isInitial = transition.fromStateId === null;

  return (
    <GlassCard className="p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {isInitial ? (
            <span className="text-muted-foreground/70">new card</span>
          ) : (
            fromName
          )}
          <span className="mx-2 text-muted-foreground/50">→</span>
          {toName}
        </span>
        <Badge
          variant="outline"
          className="border-border text-[11px] text-muted-foreground/70"
        >
          {transition.name}
        </Badge>
        {isInitial ? (
          <span className="text-[11px] text-muted-foreground/50">
            where new work starts
          </span>
        ) : null}
        {canEdit && !isInitial ? (
          <form action={removeFn} className="ml-auto">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="transitionId" value={transition.id} />
            <button
              type="submit"
              aria-label={`Remove move ${transition.name}`}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-destructive"
            >
              Remove
            </button>
          </form>
        ) : null}
      </div>
      <Err state={remove} />

      {!isInitial ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {(
            [
              ["condition", transition.conditions],
              ["validator", transition.validators],
              ["postAction", transition.postActions],
            ] as const
          ).map(([category, rules]) => (
            <div key={category}>
              <p className="text-[11px] text-muted-foreground/50">
                {CATEGORY_LABEL[category]}
              </p>
              {rules.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {rules.map((rule, index) => (
                    <RuleChip
                      key={`${category}-${index}`}
                      workspaceId={workspaceId}
                      transitionId={transition.id}
                      category={category}
                      rule={rule}
                      index={index}
                      canEdit={canEdit}
                    />
                  ))}
                </div>
              ) : null}
              {canEdit ? (
                <AddRuleForm
                  workspaceId={workspaceId}
                  transitionId={transition.id}
                  category={category}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </GlassCard>
  );
}

export function WorkflowAdmin({
  workspaceId,
  workflowName,
  states,
  transitions,
  canEdit,
}: {
  workspaceId: string;
  workflowName: string;
  states: AdminStateView[];
  transitions: AdminTransitionView[];
  /** Rendering is a courtesy — every action re-checks the capability. */
  canEdit: boolean;
}) {
  const [addState, addStateFn] = useFormState(addStateAction, undefined);
  const [addTrans, addTransFn] = useFormState(addTransitionAction, undefined);
  const nameById = new Map(states.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-baseline justify-between">
          <p className="label-mono text-brand-teal">{workflowName}</p>
          <span className="text-xs text-muted-foreground/50">
            {states.length} states · {transitions.length} moves
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground/70">
          The Production board renders straight from this. Rename a state and
          the column renames; add one and the board grows a column.
        </p>
      </div>

      {!canEdit ? (
        <GlassCard className="border-amber-400/25 p-4">
          <p className="text-sm text-amber-200/80">
            You can see this workflow but not change it. Editing needs an
            admin.
          </p>
        </GlassCard>
      ) : null}

      {/* ── States ─────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-xl">States</h2>
        <div className="mt-3 space-y-2">
          {states.map((state, index) => (
            <StateRow
              key={state.id}
              workspaceId={workspaceId}
              state={state}
              index={index}
              total={states.length}
              canEdit={canEdit}
            />
          ))}
        </div>

        {canEdit ? (
          <GlassCard className="mt-3 p-4">
            <p className="label-mono text-muted-foreground/70">Add a state</p>
            <form
              action={addStateFn}
              className="mt-3 flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <label className="text-xs text-muted-foreground/70">
                Name
                <input
                  name="name"
                  required
                  maxLength={40}
                  placeholder="Shoot day"
                  className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground/70">
                Means
                <select
                  name="category"
                  defaultValue="doing"
                  className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                >
                  <option value="todo" className="bg-popover">to do</option>
                  <option value="doing" className="bg-popover">in flight</option>
                  <option value="done" className="bg-popover">done</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground/70">
                Colour
                <select
                  name="colorKey"
                  defaultValue="violet"
                  className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                >
                  {Object.keys(WORKFLOW_STATE_COLORS).map((key) => (
                    <option key={key} value={key} className="bg-popover">
                      {key}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground/70">
                WIP limit
                <input
                  name="wipLimit"
                  type="number"
                  min={0}
                  max={999}
                  placeholder="none"
                  className="ml-2 w-24 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                />
              </label>
              <Submit label="Add state" pending="Adding…" />
            </form>
            <Err state={addState} />
          </GlassCard>
        ) : null}
      </section>

      {/* ── Moves ──────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-xl">Moves</h2>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Only these appear in a card&apos;s menu. Everything else shows as
          unreachable, so the menu teaches the process instead of hiding it.
        </p>
        <div className="mt-3 space-y-2">
          {transitions.map((transition) => (
            <TransitionRow
              key={transition.id}
              workspaceId={workspaceId}
              transition={transition}
              fromName={
                transition.fromStateId
                  ? (nameById.get(transition.fromStateId) ?? "—")
                  : ""
              }
              toName={nameById.get(transition.toStateId) ?? "—"}
              canEdit={canEdit}
            />
          ))}
        </div>

        {canEdit ? (
          <GlassCard className="mt-3 p-4">
            <p className="label-mono text-muted-foreground/70">Add a move</p>
            <form
              action={addTransFn}
              className="mt-3 flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <label className="text-xs text-muted-foreground/70">
                From
                <select
                  name="fromStateId"
                  required
                  className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                >
                  {states.map((s) => (
                    <option key={s.id} value={s.id} className="bg-popover">
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground/70">
                To
                <select
                  name="toStateId"
                  required
                  className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                >
                  {states.map((s) => (
                    <option key={s.id} value={s.id} className="bg-popover">
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground/70">
                Called
                <input
                  name="name"
                  required
                  maxLength={40}
                  placeholder="Send back"
                  className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                />
              </label>
              <Submit label="Add move" pending="Adding…" />
            </form>
            <Err state={addTrans} />
          </GlassCard>
        ) : null}
      </section>
    </div>
  );
}
