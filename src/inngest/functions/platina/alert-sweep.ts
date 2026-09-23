import { inngest } from "@/inngest/client";
import {
  countFailedRunsSince,
  countFindingsNeedingDecision,
  countPendingReceipts,
  getWorkspaceConfig,
  insertAlertDelivery,
  listActiveAlertRules,
  listOutcomes,
  markAlertRuleDelivered,
} from "@/db/queries/platina";
import { latestOpsChecks } from "@/db/queries/platina-ops";
import {
  deliveryDecision,
  evaluateAlert,
  isAlertSource,
  type AlertSource,
} from "@/lib/platina/alerts";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Alert sweep (Slice 14). Each rule evaluates against its source's record:
 * the latest first-party outcome's metrics (min-N gated), open findings
 * awaiting a decision, pending approvals, or failed/degraded runs in the
 * last 24 h. Every match writes the delivery ledger — sent, or suppressed
 * with the reason inside the 24 h window. V1 delivers in-app only.
 */
export const platinaAlertSweep = inngest.createFunction(
  {
    id: "platina-alert-sweep",
    // The ops job sends the event right after a check turns red, so that
    // alert arrives at once instead of at the next hour.
    triggers: [{ cron: "0 * * * *" }, { event: "platina/alerts.sweep.requested" }],
  },
  async ({ step }) => {
    const rules = await step.run("list-rules", () => listActiveAlertRules());
    let sent = 0;
    let suppressed = 0;
    for (const rule of rules) {
      const source: AlertSource = isAlertSource(rule.source)
        ? (rule.source as AlertSource)
        : "outcome";

      const evaluated = await step.run(`evaluate-${rule.id}`, async () => {
        if (source === "outcome") {
          const outcomes = await listOutcomes(rule.workspaceId);
          const latest = outcomes[0];
          if (!latest) return null;
          const config = await getWorkspaceConfig(rule.workspaceId);
          return evaluateAlert({
            record: {
              leads: latest.leads,
              qualifiedLeads: latest.qualifiedLeads,
              conversionRate: latest.conversionRate ?? 0,
              pipelineContribution: latest.pipelineContribution ?? 0,
              qualityScore: latest.qualityScore ?? 0,
            },
            conditions: rule.conditions,
            severity: rule.severity,
            actions: rule.actions,
            sampleSize: outcomes.length,
            minN: config?.minBaselineN ?? 20,
          });
        }
        // Operational sources: live queue counts, no min-N — these are
        // operational facts, not samples.
        if (source === "finding") {
          const open = await countFindingsNeedingDecision(rule.workspaceId);
          return evaluateAlert({
            record: { openDecisions: open },
            conditions: rule.conditions,
            severity: rule.severity,
            actions: rule.actions,
            sampleSize: 1,
            minN: 1,
          });
        }
        if (source === "approval") {
          const pending = await countPendingReceipts(rule.workspaceId);
          return evaluateAlert({
            record: { pendingReceipts: pending },
            conditions: rule.conditions,
            severity: rule.severity,
            actions: rule.actions,
            sampleSize: 1,
            minN: 1,
          });
        }
        if (source === "ops") {
          // C7.1: the latest ops-board run. An operational fact, no min-N.
          const checks = await latestOpsChecks(rule.workspaceId);
          if (checks.length === 0) return null;
          return evaluateAlert({
            record: {
              redChecks: checks.filter((c) => c.status === "down").length,
              amberChecks: checks.filter((c) => c.status === "degraded").length,
            },
            conditions: rule.conditions,
            severity: rule.severity,
            actions: rule.actions,
            sampleSize: 1,
            minN: 1,
          });
        }
        const failed = await countFailedRunsSince(
          rule.workspaceId,
          new Date(Date.now() - 24 * 60 * 60 * 1000),
        );
        return evaluateAlert({
          record: { failedRuns: failed },
          conditions: rule.conditions,
          severity: rule.severity,
          actions: rule.actions,
          sampleSize: 1,
          minN: 1,
        });
      });
      if (!evaluated?.matched) continue;

      const repeat = deliveryDecision(rule.lastRunAt) === "suppress";
      await step.run(`deliver-${rule.id}`, async () => {
        await insertAlertDelivery({
          workspaceId: rule.workspaceId,
          ruleId: rule.id,
          severity: rule.severity,
          route: "in_app",
          status: repeat ? "suppressed" : "sent",
          reason: repeat ? "repeat inside the 24h delivery window" : null,
        });
        if (!repeat) await markAlertRuleDelivered(rule.workspaceId, rule.id);
      });
      if (repeat) {
        suppressed += 1;
      } else {
        await broadcastPlatinaSignal(rule.workspaceId, "alerts", rule.id);
        sent += 1;
      }
    }
    return { rules: rules.length, sent, suppressed };
  },
);
