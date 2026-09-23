import {
  listAutomationRules,
  listAutomationRunsForRule,
} from "@/db/queries/automations";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import type { AutomationAction, AutomationTrigger } from "@/db/schema";
import { RuleForm } from "./rule-form";
import { RuleRow } from "./rule-row";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

export default async function AutomationsPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const [rules, members] = await Promise.all([
    listAutomationRules(params.ws),
    listWorkspaceMembers(params.ws),
  ]);

  const rulesWithRuns = await Promise.all(
    rules.map(async (rule) => {
      const runs = await listAutomationRunsForRule(params.ws, rule.id, 5);
      return {
        id: rule.id,
        name: rule.name,
        trigger: rule.trigger as AutomationTrigger,
        action: rule.action as AutomationAction,
        cadence: rule.cadence,
        enabled: rule.enabled,
        lastRunAt: rule.lastRunAt,
        recentRuns: runs.map((r) => ({
          status: r.status,
          matched: r.matched,
          acted: r.acted,
          createdAt: r.createdAt,
          error: r.error,
        })),
      };
    }),
  );

  return (
    <PageShell width="app">
    <div>
      <p className="label-mono text-brand-teal">Automations</p>
      <h1 className="mt-2 font-display text-4xl">
        Deterministic rules, no AI in the loop
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground/70">
        Cron-checked hourly. A rule fires when its trigger condition matches
        and its cadence is due — create a ticket, post to Team Hub, set a
        reminder, or email the team.
      </p>

      <RuleForm workspaceId={params.ws} members={members} />

      <div className="mt-6 space-y-3">
        {rulesWithRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">
            No automation rules yet — create one above.
          </p>
        ) : (
          rulesWithRuns.map((rule) => (
            <RuleRow key={rule.id} workspaceId={params.ws} rule={rule} />
          ))
        )}
      </div>
    </div>
    </PageShell>
  );
}
