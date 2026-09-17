import { inngest } from "@/inngest/client";
import {
  getWorkspaceConfig,
  insertAlertDelivery,
  listActiveAlertRules,
  listOutcomes,
  markAlertRuleDelivered,
} from "@/db/queries/platina";
import { deliveryDecision, evaluateAlert } from "@/lib/platina/alerts";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Alert sweep (Slice 10). Evaluates each enabled rule against the workspace's
 * latest first-party outcome, with the workspace's stored minimum-N (not a
 * hardcoded floor). Every evaluation outcome is recorded in the delivery
 * ledger: sent, suppressed (repeat inside the window), or failed — with the
 * reason. V1 delivers in-app only: a delivery writes the ledger row and
 * broadcasts the alerts scope; nothing emails or posts anywhere.
 */
export const platinaAlertSweep = inngest.createFunction(
  {
    id: "platina-alert-sweep",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const rules = await step.run("list-rules", () => listActiveAlertRules());
    let sent = 0;
    let suppressed = 0;
    for (const rule of rules) {
      const outcomes = await step.run(`outcomes-${rule.id}`, () =>
        listOutcomes(rule.workspaceId),
      );
      const latest = outcomes[0];
      if (!latest) continue;
      const config = await step.run(`config-${rule.id}`, () =>
        getWorkspaceConfig(rule.workspaceId),
      );
      const result = await step.run(`evaluate-${rule.id}`, async () =>
        evaluateAlert({
          record: {
            conversionRate: latest.conversionRate ?? 0,
            leads: latest.leads,
            qualifiedLeads: latest.qualifiedLeads,
            pipelineContribution: latest.pipelineContribution ?? 0,
            qualityScore: latest.qualityScore ?? 0,
          },
          conditions: rule.conditions,
          severity: rule.severity,
          actions: rule.actions,
          sampleSize: outcomes.length,
          minN: config?.minBaselineN ?? 20,
        }),
      );
      if (!result.matched) continue;

      const decision = deliveryDecision(rule.lastRunAt);
      const repeat = decision === "suppress";
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
