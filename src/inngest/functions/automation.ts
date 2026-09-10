// No AI/router calls anywhere in this function — deterministic only
// (constitution: automation v1 stays out of AI-cost/router territory).
//
// Known v1 limitation, documented not fixed: this is a cron-only re-
// evaluation sweep with no per-(rule,object) dedupe ledger. A still-matching
// object (e.g. an idea that stays "new" and stale) can have its rule's
// action re-fire on every tick the rule is due. Cadence bounds the damage —
// "daily" bounds a rule to at most one re-fire per day, "hourly" to at most
// one per hour — but within that window the same object can be acted on
// more than once if it matches on consecutive due-runs. A dedupe ledger
// (recording which (ruleId, matchedObjectId) pairs have already been acted
// on) is a real follow-up, intentionally not built here (A2 spec).
//
// G3 added a coarser, rule-level guard on top of the cadence gate below
// (hasRecentAutomationRun, checked against the automationRuns ledger
// itself rather than the rule's own lastRunAt field) — it catches
// concurrent/duplicate sweep invocations that automationRunDue's
// lastRunAt check can't, but it is not the per-object ledger described
// above and doesn't change the limitation.

import { inngest } from "@/inngest/client";
import type { AutomationAction, AutomationTrigger } from "@/db/schema";
import {
  createAutomationRun,
  finishAutomationRun,
  hasRecentAutomationRun,
  listEnabledAutomationRules,
  markAutomationRuleRan,
  staleNewIdeas,
  stalePendingApprovals,
  unassignedHighPriorityTickets,
} from "@/db/queries/automations";
import { listImmediateMemberEmails } from "@/db/queries/memberships";
import { hubMessages, hubReminders } from "@/db/schema";
import { db } from "@/db";
import { recordActivity } from "@/lib/activity";
import { createTicket } from "@/db/queries/tickets";
import { automationRunDue, linkForTrigger, triggerCutoff } from "@/lib/automation";
import { resend } from "@/lib/resend";

type MatchedRow = { id: string; workspaceId: string };

/**
 * Dispatch to the matching A1 read query by trigger.kind. Each query is
 * already workspace-scoped in its WHERE (see src/db/queries/automations.ts);
 * this function only picks which one to call.
 */
async function evaluateTrigger(
  workspaceId: string,
  trigger: AutomationTrigger,
  cutoff: Date,
): Promise<MatchedRow[]> {
  switch (trigger.kind) {
    case "idea_stale":
      return staleNewIdeas(workspaceId, cutoff);
    case "approval_stale":
      return stalePendingApprovals(workspaceId, cutoff);
    case "ticket_unassigned":
      return unassignedHighPriorityTickets(workspaceId, cutoff);
    case "event":
      return [];
  }
}

/**
 * Run one action for one matched row. Every DB write here is scoped to
 * `workspaceId` — the per-row-own-workspace safety pattern from
 * reminders.ts — even though the caller already re-scopes per rule, this is
 * the actual write boundary so it's enforced at the point of the write too.
 *
 * `link` (F9.2) is only consulted by the create_ticket case — it's the
 * matched row's back-link, computed by the caller via linkForTrigger since
 * the trigger kind lives on the rule, not the action. The other action
 * kinds (hub_message/hub_reminder/email) act on the workspace as a whole,
 * not on any single match, so `link` is unused for them.
 *
 * Returns true if the action counts toward the run's `acted` total. An
 * email-send failure does NOT throw — it's caught, logged, and skipped from
 * the `acted` count (mirrors contentReminder in reminders.ts, which logs and
 * `return`s past a failed send rather than failing the whole sweep). This
 * keeps one bad email provider hiccup from flipping an otherwise-successful
 * rule run to status:"failed" for unrelated create_ticket/hub_message/
 * hub_reminder matches processed in the same run.
 */
async function runAction(
  workspaceId: string,
  action: AutomationAction,
  createdById: string,
  link: { linkedType: "idea" | null; linkedId: string | null },
): Promise<boolean> {
  // actorId stays null on every branch below: an automation is not a person,
  // and attributing its writes to the rule's author would put words in a
  // human's mouth in the history.
  await recordActivity({
    workspaceId,
    subjectType: link.linkedType === "idea" && link.linkedId ? "idea" : "client",
    subjectId: link.linkedId ?? workspaceId,
    actorId: null,
    verb: `automation_${action.kind}`,
  });

  switch (action.kind) {
    case "create_ticket": {
      await createTicket({
        workspaceId,
        title: action.title,
        priority: action.priority,
        createdById,
        linkedType: link.linkedType,
        linkedId: link.linkedId,
      });
      return true;
    }
    case "hub_message": {
      await db.insert(hubMessages).values({
        workspaceId,
        kind: "system",
        body: action.body,
      });
      return true;
    }
    case "hub_reminder": {
      await db.insert(hubReminders).values({
        workspaceId,
        title: action.title,
        dueAt: new Date(Date.now() + action.hoursFromNow * 60 * 60 * 1000),
        ownerId: action.ownerId,
      });
      return true;
    }
    case "email": {
      try {
        // Honours each member's digest preference. An automation firing
        // hourly is exactly the sender people mute first, so "off" has to
        // work here or the preference is decorative.
        const to = await listImmediateMemberEmails(workspaceId);
        if (to.length === 0) return false;
        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || "onboarding@resend.dev",
          to,
          subject: action.subject,
          html: action.body,
        });
        if (error) {
          console.error(
            `automation email action failed (ws ${workspaceId}):`,
            error,
          );
          return false;
        }
        return true;
      } catch (error) {
        console.error(
          `automation email action failed (ws ${workspaceId}):`,
          error instanceof Error ? error.message : "Unknown error",
        );
        return false;
      }
    }
  }
}

/**
 * Automation cron sweep (A2). Cron-only v1 — no event trigger, hourly tick;
 * per-rule cadence (hourly|daily) gates whether a given rule actually runs
 * on any tick via automationRunDue. Structured like pattern-scan.ts: plan
 * once, then per-rule try/catch so one bad rule never aborts the batch.
 */
export const automationSweep = inngest.createFunction(
  { id: "automation-sweep", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    const now = new Date();
    const rules = await step.run("plan-rules", async () => {
      const enabled = await listEnabledAutomationRules();
      return enabled.filter((r) => automationRunDue(r, now));
    });

    for (const rule of rules) {
      await step.run(`rule-${rule.id}`, async () => {
        // G3 dedupe guard: automationRunDue already filtered on lastRunAt,
        // but that field can lag reality (crash before markAutomationRuleRan
        // persists, or a concurrent sweep invocation). Re-checking against
        // the actual run ledger here, at execution time, catches what the
        // upstream filter can miss.
        const windowMinutes = rule.cadence === "hourly" ? 60 : 24 * 60;
        const alreadyRan = await hasRecentAutomationRun(
          rule.workspaceId,
          rule.id,
          windowMinutes,
        );
        if (alreadyRan) return;

        const runId = await createAutomationRun(rule.workspaceId, rule.id);
        try {
          const trigger = rule.trigger as AutomationTrigger;
          const action = rule.action as AutomationAction;
          const cutoff = triggerCutoff(trigger, now);
          const matches = await evaluateTrigger(
            rule.workspaceId,
            trigger,
            cutoff,
          );

          let acted = 0;
          // One runAction call per matched row. create_ticket (F9.2) now
          // uses the match's own id to back-link the created ticket to its
          // trigger — computed here via linkForTrigger since trigger.kind
          // lives on the rule, not the action. The other action kinds
          // (hub_message/hub_reminder/email) still act on the workspace as
          // a whole and ignore the link. Every match is already confirmed
          // to belong to rule.workspaceId by evaluateTrigger's own
          // workspace-scoped WHERE; runAction is still called with
          // rule.workspaceId explicitly (never a field off the match) so
          // the write boundary can't drift even if a future trigger kind's
          // query shape changes.
          for (let i = 0; i < matches.length; i += 1) {
            const link = linkForTrigger(trigger.kind, matches[i].id);
            const didAct = await runAction(
              rule.workspaceId,
              action,
              rule.createdById,
              link,
            );
            if (didAct) acted += 1;
          }

          await finishAutomationRun(runId, {
            status: "done",
            matched: matches.length,
            acted,
          });
          await markAutomationRuleRan(rule.id, now);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown automation error";
          console.error(
            `automation-sweep rule failed (ws ${rule.workspaceId}, rule ${rule.id}):`,
            message,
          );
          await finishAutomationRun(runId, {
            status: "failed",
            matched: 0,
            acted: 0,
            error: message,
          });
        }
      });
    }

    return { rules: rules.length };
  },
);
