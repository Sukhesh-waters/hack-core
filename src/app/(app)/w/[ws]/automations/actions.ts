"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleEnabled,
  updateAutomationRule,
} from "@/db/queries/automations";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  automationActionSchema,
  automationRuleShellSchema,
  automationTriggerSchema,
  isSensibleRule,
} from "@/lib/automation";

export type AutomationRuleState = { error?: string } | undefined;

/** Parse the trigger sub-shape out of a submitted form based on the chosen
 *  trigger kind — mirrors how rule-form.tsx only renders the matching
 *  numeric field for the selected kind. */
function parseTriggerFromForm(formData: FormData) {
  const kind = formData.get("triggerKind");
  if (kind === "idea_stale") {
    return automationTriggerSchema.safeParse({
      kind,
      days: Number(formData.get("triggerDays")),
    });
  }
  if (kind === "approval_stale" || kind === "ticket_unassigned") {
    return automationTriggerSchema.safeParse({
      kind,
      hours: Number(formData.get("triggerHours")),
    });
  }
  return automationTriggerSchema.safeParse({ kind });
}

/** Parse the action sub-shape out of a submitted form based on the chosen
 *  action kind. */
function parseActionFromForm(formData: FormData) {
  const kind = formData.get("actionKind");
  if (kind === "create_ticket") {
    return automationActionSchema.safeParse({
      kind,
      title: formData.get("actionTitle"),
      priority: formData.get("actionPriority"),
    });
  }
  if (kind === "hub_message") {
    return automationActionSchema.safeParse({
      kind,
      body: formData.get("actionBody"),
    });
  }
  if (kind === "hub_reminder") {
    return automationActionSchema.safeParse({
      kind,
      title: formData.get("actionTitle"),
      hoursFromNow: Number(formData.get("actionHoursFromNow")),
      ownerId: formData.get("actionOwnerId"),
    });
  }
  if (kind === "email") {
    return automationActionSchema.safeParse({
      kind,
      subject: formData.get("actionSubject"),
      body: formData.get("actionBody"),
      audience: "team",
    });
  }
  return automationActionSchema.safeParse({ kind });
}

export async function createAutomationRuleAction(
  _prev: AutomationRuleState,
  formData: FormData,
): Promise<AutomationRuleState> {
  const shell = automationRuleShellSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    cadence: formData.get("cadence"),
    enabled: formData.get("enabled") === "on",
  });
  if (!shell.success) return { error: shell.error.issues[0].message };

  const trigger = parseTriggerFromForm(formData);
  if (!trigger.success) return { error: trigger.error.issues[0].message };

  const action = parseActionFromForm(formData);
  if (!action.success) return { error: action.error.issues[0].message };

  if (!isSensibleRule(trigger.data.kind, action.data.kind)) {
    return {
      error: "This trigger and action combination doesn't make sense together.",
    };
  }

  const { workspaceId, name, cadence, enabled } = shell.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await createAutomationRule({
      workspaceId,
      name,
      trigger: trigger.data,
      action: action.data,
      cadence,
      enabled,
      createdById: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/automations`);
  return undefined;
}

export async function toggleAutomationRuleAction(
  _prev: AutomationRuleState,
  formData: FormData,
): Promise<AutomationRuleState> {
  const workspaceId = formData.get("workspaceId");
  const ruleId = formData.get("ruleId");
  const enabled = formData.get("enabled") === "true";
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  if (typeof ruleId !== "string" || ruleId.length === 0) {
    return { error: "Missing rule" };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await setAutomationRuleEnabled(workspaceId, ruleId, enabled);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/automations`);
  return undefined;
}

export async function deleteAutomationRuleAction(
  _prev: AutomationRuleState,
  formData: FormData,
): Promise<AutomationRuleState> {
  const workspaceId = formData.get("workspaceId");
  const ruleId = formData.get("ruleId");
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  if (typeof ruleId !== "string" || ruleId.length === 0) {
    return { error: "Missing rule" };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await deleteAutomationRule(workspaceId, ruleId);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/automations`);
  return undefined;
}

export async function updateAutomationRuleAction(
  _prev: AutomationRuleState,
  formData: FormData,
): Promise<AutomationRuleState> {
  const workspaceId = formData.get("workspaceId");
  const ruleId = formData.get("ruleId");
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  if (typeof ruleId !== "string" || ruleId.length === 0) {
    return { error: "Missing rule" };
  }

  const shell = automationRuleShellSchema.safeParse({
    workspaceId,
    name: formData.get("name"),
    cadence: formData.get("cadence"),
    enabled: formData.get("enabled") === "on",
  });
  if (!shell.success) return { error: shell.error.issues[0].message };

  const trigger = parseTriggerFromForm(formData);
  if (!trigger.success) return { error: trigger.error.issues[0].message };

  const action = parseActionFromForm(formData);
  if (!action.success) return { error: action.error.issues[0].message };

  if (!isSensibleRule(trigger.data.kind, action.data.kind)) {
    return {
      error: "This trigger and action combination doesn't make sense together.",
    };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await updateAutomationRule(workspaceId, ruleId, {
      name: shell.data.name,
      cadence: shell.data.cadence,
      trigger: trigger.data,
      action: action.data,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/automations`);
  return undefined;
}
