"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/glass-card";
import { isSensibleRule } from "@/lib/automation";
import {
  createAutomationRuleAction,
  type AutomationRuleState,
} from "./actions";

export type MemberOption = { userId: string; name: string | null; email: string };

const selectClasses =
  "h-9 rounded-md border border-border bg-transparent px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal";

const TRIGGER_KINDS = [
  { value: "idea_stale", label: "Idea sits unassigned (days)" },
  { value: "approval_stale", label: "Approval pending too long (hours)" },
  { value: "ticket_unassigned", label: "High-priority ticket unassigned (hours)" },
] as const;

const ACTION_KINDS = [
  { value: "create_ticket", label: "Create a ticket" },
  { value: "hub_message", label: "Post to Team Hub" },
  { value: "hub_reminder", label: "Set a reminder" },
  { value: "email", label: "Email the team" },
] as const;

type TriggerKindValue = (typeof TRIGGER_KINDS)[number]["value"];
type ActionKindValue = (typeof ACTION_KINDS)[number]["value"];

/**
 * C2 — one-click starter templates. Fixes the "zero starter templates, zero
 * onboarding" activation-energy gap from yc-standards-audit.md: clicking one
 * of these pre-fills the form's own client-side state (trigger/action kind
 * plus the text/number fields below) — not a new DB concept, not a separate
 * submit path. The user can still edit anything before saving.
 */
type RuleTemplate = {
  key: string;
  label: string;
  name: string;
  triggerKind: TriggerKindValue;
  triggerDays?: number;
  triggerHours?: number;
  actionKind: ActionKindValue;
  actionTitle?: string;
  actionPriority?: "high" | "medium" | "low";
  actionBody?: string;
  actionSubject?: string;
};

const RULE_TEMPLATES: RuleTemplate[] = [
  {
    key: "stale-idea-ticket",
    label: "Follow up on stale ideas",
    name: "Follow up on stale ideas",
    triggerKind: "idea_stale",
    triggerDays: 3,
    actionKind: "create_ticket",
    actionTitle: "Follow up on stale idea",
    actionPriority: "medium",
  },
  {
    key: "stale-idea-email",
    label: "Email me about stale ideas",
    name: "Email me about stale ideas",
    triggerKind: "idea_stale",
    triggerDays: 3,
    actionKind: "email",
    actionSubject: "Stale ideas need review",
    actionBody:
      "A few ideas haven't moved in 3+ days. Take a look and either move them forward or archive them.",
  },
  {
    key: "unassigned-ticket-flag",
    label: "Flag long-unassigned high-priority tickets",
    name: "Flag long-unassigned high-priority tickets",
    triggerKind: "ticket_unassigned",
    triggerHours: 24,
    actionKind: "hub_message",
    actionBody: "A high-priority ticket has gone unassigned for over a day.",
  },
];

/** Text/number fields a template can pre-fill. Kept separate from
 *  triggerKind/actionKind (which drive which fields even render) since
 *  those two already have their own useState. */
type TemplatePrefill = {
  name?: string;
  triggerDays?: number;
  triggerHours?: number;
  actionTitle?: string;
  actionPriority?: "high" | "medium" | "low";
  actionBody?: string;
  actionSubject?: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Saving…" : "New automation"}
    </Button>
  );
}

export function RuleForm({
  workspaceId,
  members,
}: {
  workspaceId: string;
  members: MemberOption[];
}) {
  const [state, formAction] = useActionState<AutomationRuleState, FormData>(
    createAutomationRuleAction,
    undefined,
  );
  const [triggerKind, setTriggerKind] =
    useState<TriggerKindValue>("idea_stale");
  const [actionKind, setActionKind] =
    useState<ActionKindValue>("create_ticket");
  const [prefill, setPrefill] = useState<TemplatePrefill>({});
  // Bumped on every template click and used as the <form>'s key, forcing a
  // fresh mount of all the uncontrolled inputs below so their defaultValue
  // (sourced from `prefill`) actually takes effect — React only applies
  // defaultValue at mount, so without this an already-mounted field (e.g.
  // the form's pristine, default create_ticket title) wouldn't visibly
  // update when a template sets a new value for it.
  const [formKey, setFormKey] = useState(0);

  // C2 guard: ticket_unassigned + create_ticket is the one confirmed
  // circular combination (a ticket about an unassigned ticket) — filter it
  // out of the action-kind options entirely so it's never selectable, not
  // just rejected after the fact.
  const availableActionKinds = ACTION_KINDS.filter((a) =>
    isSensibleRule(triggerKind, a.value),
  );

  function applyTemplate(template: RuleTemplate) {
    setTriggerKind(template.triggerKind);
    setActionKind(template.actionKind);
    setPrefill({
      name: template.name,
      triggerDays: template.triggerDays,
      triggerHours: template.triggerHours,
      actionTitle: template.actionTitle,
      actionPriority: template.actionPriority,
      actionBody: template.actionBody,
      actionSubject: template.actionSubject,
    });
    setFormKey((key) => key + 1);
  }

  return (
    <GlassCard className="mt-6 space-y-3 p-4">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Start from a template</p>
        <div className="flex flex-wrap gap-2">
          {RULE_TEMPLATES.map((template) => (
            <Button
              key={template.key}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyTemplate(template)}
            >
              {template.label}
            </Button>
          ))}
        </div>
      </div>

      <form key={formKey} action={formAction} className="space-y-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            name="name"
            placeholder="Rule name"
            maxLength={140}
            required
            defaultValue={prefill.name}
            className="min-w-48 flex-1"
          />
          <select name="cadence" className={selectClasses} defaultValue="daily">
            <option value="hourly" className="bg-neutral-900">
              Hourly
            </option>
            <option value="daily" className="bg-neutral-900">
              Daily
            </option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" name="enabled" className="accent-brand-teal" />
            Enabled
          </label>
        </div>

        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto]">
          <select
            name="triggerKind"
            className={selectClasses}
            value={triggerKind}
            onChange={(e) => {
              const nextTriggerKind = e.target.value as TriggerKindValue;
              setTriggerKind(nextTriggerKind);
              // Keep the current action selection in sync with the guard:
              // if switching trigger kind makes the current action
              // nonsensical (ticket_unassigned + create_ticket), fall back
              // to a sensible default instead of leaving a filtered-out
              // value selected.
              if (!isSensibleRule(nextTriggerKind, actionKind)) {
                setActionKind("hub_message");
              }
            }}
          >
            {TRIGGER_KINDS.map((t) => (
              <option key={t.value} value={t.value} className="bg-neutral-900">
                {t.label}
              </option>
            ))}
          </select>
          {triggerKind === "idea_stale" ? (
            <Input
              name="triggerDays"
              type="number"
              min={1}
              step={1}
              defaultValue={prefill.triggerDays ?? 3}
              className="w-24"
              aria-label="Days"
              required
            />
          ) : (
            <Input
              name="triggerHours"
              type="number"
              min={1}
              step={1}
              defaultValue={prefill.triggerHours ?? 24}
              className="w-24"
              aria-label="Hours"
              required
            />
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <select
            name="actionKind"
            className={selectClasses}
            value={actionKind}
            onChange={(e) => setActionKind(e.target.value as ActionKindValue)}
          >
            {availableActionKinds.map((a) => (
              <option key={a.value} value={a.value} className="bg-neutral-900">
                {a.label}
              </option>
            ))}
          </select>

          {actionKind === "create_ticket" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                name="actionTitle"
                placeholder="Ticket title"
                maxLength={200}
                required
                defaultValue={prefill.actionTitle}
                className="min-w-48 flex-1"
              />
              <select
                name="actionPriority"
                className={selectClasses}
                defaultValue={prefill.actionPriority ?? "medium"}
              >
                {["high", "medium", "low"].map((p) => (
                  <option key={p} value={p} className="bg-neutral-900">
                    {p}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {actionKind === "hub_message" ? (
            <Textarea
              name="actionBody"
              placeholder="Message body"
              maxLength={2000}
              rows={2}
              required
              defaultValue={prefill.actionBody}
            />
          ) : null}

          {actionKind === "hub_reminder" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                name="actionTitle"
                placeholder="Reminder title"
                maxLength={200}
                required
                className="min-w-40 flex-1"
              />
              <Input
                name="actionHoursFromNow"
                type="number"
                min={1}
                step={1}
                defaultValue={24}
                className="w-24"
                aria-label="Hours from now"
                required
              />
              <select
                name="actionOwnerId"
                className={selectClasses}
                defaultValue=""
                required
              >
                <option value="" className="bg-neutral-900" disabled>
                  Owner
                </option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId} className="bg-neutral-900">
                    {m.name ?? m.email}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {actionKind === "email" ? (
            <div className="space-y-2">
              <Input
                name="actionSubject"
                placeholder="Email subject"
                maxLength={200}
                required
                defaultValue={prefill.actionSubject}
              />
              <Textarea
                name="actionBody"
                placeholder="Email body (HTML or plain text)"
                maxLength={5000}
                rows={3}
                required
                defaultValue={prefill.actionBody}
              />
              <p className="text-xs text-muted-foreground/70">Sends to the whole team.</p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <SubmitButton />
        </div>
        {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      </form>
    </GlassCard>
  );
}
