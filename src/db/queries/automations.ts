import { and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  automationRules,
  automationRuns,
  hubApprovals,
  ideas,
  tickets,
  type AutomationAction,
  type AutomationTrigger,
} from "@/db/schema";
import type { patternRunStatus } from "@/db/schema";

// ---------------------------------------------------------------------------
// CRUD — automation_rules. Every one of these is workspace-scoped in its
// WHERE (constitution isolation rule); builder/wrapper split throughout so
// SQL shape is directly assertable in tests.
// ---------------------------------------------------------------------------

export function automationRulesQuery(workspaceId: string) {
  return db
    .select()
    .from(automationRules)
    .where(eq(automationRules.workspaceId, workspaceId))
    .orderBy(desc(automationRules.createdAt));
}

export async function listAutomationRules(workspaceId: string) {
  return automationRulesQuery(workspaceId);
}

export async function getAutomationRule(workspaceId: string, ruleId: string) {
  const rows = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.workspaceId, workspaceId),
        eq(automationRules.id, ruleId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createAutomationRule(input: {
  workspaceId: string;
  name: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  cadence: "hourly" | "daily";
  enabled?: boolean;
  createdById: string;
}): Promise<string> {
  const [row] = await db
    .insert(automationRules)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      trigger: input.trigger,
      action: input.action,
      cadence: input.cadence,
      enabled: input.enabled ?? false,
      createdById: input.createdById,
    })
    .returning({ id: automationRules.id });
  return row.id;
}

/** Guard-in-WHERE builder (exposed for SQL-shape assertions). Workspace+id
 *  scoped like every other mutation in this file. */
export function setAutomationRuleEnabledQuery(
  workspaceId: string,
  ruleId: string,
  enabled: boolean,
) {
  return db
    .update(automationRules)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(
        eq(automationRules.workspaceId, workspaceId),
        eq(automationRules.id, ruleId),
      ),
    )
    .returning({ id: automationRules.id });
}

export async function setAutomationRuleEnabled(
  workspaceId: string,
  ruleId: string,
  enabled: boolean,
) {
  const rows = await setAutomationRuleEnabledQuery(
    workspaceId,
    ruleId,
    enabled,
  );
  if (rows.length === 0) {
    throw new Error("Automation rule not found in this workspace.");
  }
  return rows[0];
}

export type AutomationRuleFieldUpdate = {
  name?: string;
  trigger?: AutomationTrigger;
  action?: AutomationAction;
  cadence?: "hourly" | "daily";
};

/** Guard-in-WHERE builder (exposed for SQL-shape assertions). */
export function updateAutomationRuleQuery(
  workspaceId: string,
  ruleId: string,
  fields: AutomationRuleFieldUpdate,
) {
  return db
    .update(automationRules)
    .set({ ...fields, updatedAt: new Date() })
    .where(
      and(
        eq(automationRules.workspaceId, workspaceId),
        eq(automationRules.id, ruleId),
      ),
    )
    .returning({ id: automationRules.id });
}

export async function updateAutomationRule(
  workspaceId: string,
  ruleId: string,
  fields: AutomationRuleFieldUpdate,
) {
  const rows = await updateAutomationRuleQuery(workspaceId, ruleId, fields);
  if (rows.length === 0) {
    throw new Error("Automation rule not found in this workspace.");
  }
  return rows[0];
}

/** Guard-in-WHERE builder for hard delete (exposed for SQL-shape
 *  assertions). Cascades to automation_runs via its existing FK cascade. */
export function deleteAutomationRuleQuery(
  workspaceId: string,
  ruleId: string,
) {
  return db
    .delete(automationRules)
    .where(
      and(
        eq(automationRules.workspaceId, workspaceId),
        eq(automationRules.id, ruleId),
      ),
    )
    .returning({ id: automationRules.id });
}

export async function deleteAutomationRule(
  workspaceId: string,
  ruleId: string,
) {
  const rows = await deleteAutomationRuleQuery(workspaceId, ruleId);
  if (rows.length === 0) {
    throw new Error("Automation rule not found in this workspace.");
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Cross-workspace cron sweep — documented exception, same idiom as
// dueRemindersQuery (src/db/queries/schedule.ts) and listEnabledHarnessRules
// (src/db/queries/harness.ts): system-level, no workspace filter. Each
// returned row carries its own workspace_id so the future A2 runner
// re-scopes per row — this is the ONLY cross-workspace query in this file.
// ---------------------------------------------------------------------------

export function listEnabledAutomationRulesQuery() {
  return db
    .select()
    .from(automationRules)
    .where(eq(automationRules.enabled, true));
}

export async function listEnabledAutomationRules() {
  return listEnabledAutomationRulesQuery();
}

// ---------------------------------------------------------------------------
// Audit-trail writers — mirror patternRuns' equivalents (createPatternRun /
// finishPatternRun / markRuleRan in src/db/queries/harness.ts).
// ---------------------------------------------------------------------------

export async function createAutomationRun(
  workspaceId: string,
  ruleId: string,
) {
  const [row] = await db
    .insert(automationRuns)
    .values({
      workspaceId,
      ruleId,
      status: "queued",
    })
    .returning({ id: automationRuns.id });
  return row.id;
}

export async function finishAutomationRun(
  runId: string,
  outcome: {
    status: (typeof patternRunStatus.enumValues)[number];
    matched: number;
    acted: number;
    error?: string;
  },
) {
  await db
    .update(automationRuns)
    .set({
      status: outcome.status,
      matched: outcome.matched,
      acted: outcome.acted,
      error: outcome.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(automationRuns.id, runId));
}

export async function markAutomationRuleRan(ruleId: string, now: Date) {
  await db
    .update(automationRules)
    .set({ lastRunAt: now })
    .where(eq(automationRules.id, ruleId));
}

export function automationRunsQuery(workspaceId: string, limit = 20) {
  return db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.workspaceId, workspaceId))
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

export async function listAutomationRuns(workspaceId: string, limit = 20) {
  return automationRunsQuery(workspaceId, limit);
}

/** V3 (Marketing OS overview): recent FAILED runs across the whole
 *  workspace, joined to the owning rule's name so the glance card can show
 *  "which automation broke" without a second round-trip. Workspace-scoped
 *  like every other query in this file — this is NOT the cross-workspace
 *  cron sweep (listEnabledAutomationRulesQuery above); that one stays
 *  cron-only and must never be used on a user-facing page. */
export function recentFailedAutomationRunsQuery(
  workspaceId: string,
  limit = 5,
) {
  return db
    .select({
      id: automationRuns.id,
      ruleId: automationRuns.ruleId,
      ruleName: automationRules.name,
      error: automationRuns.error,
      finishedAt: automationRuns.finishedAt,
      createdAt: automationRuns.createdAt,
    })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
    .where(
      and(
        eq(automationRuns.workspaceId, workspaceId),
        eq(automationRuns.status, "failed"),
      ),
    )
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

export async function recentFailedAutomationRuns(
  workspaceId: string,
  limit = 5,
) {
  return recentFailedAutomationRunsQuery(workspaceId, limit);
}

/** A2: recent runs for ONE rule — workspace+rule scoped, powers the rule
 *  list UI's "recent run status" column. automationRunsQuery above is
 *  workspace-only (used for a future all-rules audit view); this is the
 *  narrower per-rule variant the UI actually needs. */
export function automationRunsForRuleQuery(
  workspaceId: string,
  ruleId: string,
  limit = 5,
) {
  return db
    .select()
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.workspaceId, workspaceId),
        eq(automationRuns.ruleId, ruleId),
      ),
    )
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

export async function listAutomationRunsForRule(
  workspaceId: string,
  ruleId: string,
  limit = 5,
) {
  return automationRunsForRuleQuery(workspaceId, ruleId, limit);
}

// ---------------------------------------------------------------------------
// Trigger-evaluation read queries — one per AutomationTrigger kind, each
// workspace-scoped and taking a cutoff Date computed by triggerCutoff
// (src/lib/automation.ts).
// ---------------------------------------------------------------------------

export function staleNewIdeasQuery(workspaceId: string, cutoff: Date) {
  return db
    .select()
    .from(ideas)
    .where(
      and(
        eq(ideas.workspaceId, workspaceId),
        eq(ideas.status, "new"),
        lt(ideas.createdAt, cutoff),
      ),
    );
}

export async function staleNewIdeas(workspaceId: string, cutoff: Date) {
  return staleNewIdeasQuery(workspaceId, cutoff);
}

export function stalePendingApprovalsQuery(workspaceId: string, cutoff: Date) {
  return db
    .select()
    .from(hubApprovals)
    .where(
      and(
        eq(hubApprovals.workspaceId, workspaceId),
        eq(hubApprovals.status, "pending"),
        lt(hubApprovals.createdAt, cutoff),
      ),
    );
}

export async function stalePendingApprovals(
  workspaceId: string,
  cutoff: Date,
) {
  return stalePendingApprovalsQuery(workspaceId, cutoff);
}

export function unassignedHighPriorityTicketsQuery(
  workspaceId: string,
  cutoff: Date,
) {
  return db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        eq(tickets.priority, "high"),
        isNull(tickets.assigneeId),
        ne(tickets.status, "done"),
        lt(tickets.createdAt, cutoff),
      ),
    );
}

export async function unassignedHighPriorityTickets(
  workspaceId: string,
  cutoff: Date,
) {
  return unassignedHighPriorityTicketsQuery(workspaceId, cutoff);
}

/**
 * G3 — Deduplication ledger check, read against `automationRuns` (the
 * actual completed-run ledger) rather than `automationRules.lastRunAt`
 * (a single mutable field on the rule row that `automationRunDue`'s
 * cadence gate already relies on). The two checks are usually redundant,
 * which is the point: this one is the fallback that still holds if
 * `markAutomationRuleRan` failed to persist after a crash mid-run, or if
 * the sweep is invoked twice concurrently (Inngest at-least-once
 * delivery). It does NOT solve the coarser, intentionally-deferred gap
 * documented at the top of automation.ts — a still-matching object can
 * still be re-acted-on across two separately-due cadence ticks, since
 * this checks "did the RULE run recently," not "was this OBJECT already
 * acted on." That remains real follow-up work, not this slice's scope.
 */
export function hasRecentAutomationRunQuery(
  workspaceId: string,
  ruleId: string,
  cutoff: Date,
) {
  return db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.workspaceId, workspaceId),
        eq(automationRuns.ruleId, ruleId),
        gte(automationRuns.createdAt, cutoff),
      ),
    )
    .limit(1);
}

export async function hasRecentAutomationRun(
  workspaceId: string,
  ruleId: string,
  windowMinutes = 60,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  const rows = await hasRecentAutomationRunQuery(workspaceId, ruleId, cutoff);
  return rows.length > 0;
}
