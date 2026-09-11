import { inngest } from "@/inngest/client";
import { listActiveAlertRules, listOutcomes } from "@/db/queries/platina";
import { evaluateAlert } from "@/lib/platina/alerts";

export const platinaAlertSweep = inngest.createFunction(
  {
    id: "platina-alert-sweep",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const rules = await step.run("list-rules", () => listActiveAlertRules());
    let fired = 0;
    for (const rule of rules) {
      const outcomes = await step.run(`outcomes-${rule.workspaceId}`, () =>
        listOutcomes(rule.workspaceId),
      );
      const latest = outcomes[0];
      if (!latest) continue;
      const result = evaluateAlert({
        record: {
          conversionRate: latest.conversionRate ?? 0,
          leads: latest.leads,
        },
        conditions: rule.conditions,
        severity: rule.severity,
        actions: rule.actions,
        sampleSize: outcomes.length,
        minN: 5,
      });
      if (result.matched) fired += 1;
    }
    return { rules: rules.length, fired };
  },
);
