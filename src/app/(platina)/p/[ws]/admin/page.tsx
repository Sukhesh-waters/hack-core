import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import {
  getWorkspaceConfig,
  getWorkspaceProfile,
  listAlertDeliveries,
  listAlertRules,
  listGateEvents,
} from "@/db/queries/platina";
import {
  addAlertRuleAction,
  saveConfigAction,
  saveProfileAction,
  toggleAlertRuleAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina admin" };

const ANALYSIS_STEPS = [
  { value: "competitor_scan", label: "Competitor scan" },
  { value: "brand_divergence", label: "Brand divergence" },
  { value: "ideation", label: "Ideation" },
  { value: "claims_screen", label: "Claims screen" },
] as const;

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const [config, profile, rules, deliveries, gates] = await Promise.all([
    getWorkspaceConfig(params.ws),
    getWorkspaceProfile(params.ws),
    listAlertRules(params.ws),
    listAlertDeliveries(params.ws),
    listGateEvents(params.ws),
  ]);
  const configHistory = gates.filter(
    (g) => g.subjectType === "workspace_config",
  );
  const enabledSteps = new Set(config?.analysisSequence ?? []);

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Workspace administration"
      description="Configuration for authorized users. Changes apply to future runs only — they never rewrite recorded history."
    >
      <PlatinaFormError message={searchParams.error} />
      <div className="mb-8 grid gap-3 md:grid-cols-2">
        <Link
          href={`/p/${params.ws}/admin/brand`}
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <p className="font-medium">Brand standard</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Declare and confirm the approved brand standard — the evidence
            every solution must anchor to.
          </p>
        </Link>
        <Link
          href={`/p/${params.ws}/admin/claims`}
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <p className="font-medium">Claims and terminology</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Screen marketing copy against the claims rules.
          </p>
        </Link>
      </div>

      <section aria-label="Division and region" className="mb-8 max-w-md">
        <h2 className="font-display text-lg font-medium">
          Division and region
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One workspace is one division × region operating boundary. This
          labels the scope on every primary surface; it never changes which
          data the workspace can see.
        </p>
        <form action={saveProfileAction} className="mt-4 grid gap-3">
          <input type="hidden" name="workspaceId" value={params.ws} />
          <label className="text-xs font-medium">
            Division
            <input
              name="division"
              defaultValue={profile?.division ?? ""}
              placeholder="Life Sciences"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Region
            <input
              name="region"
              defaultValue={profile?.region ?? ""}
              placeholder="North America"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Business unit (optional)
            <input
              name="businessUnit"
              defaultValue={profile?.businessUnit ?? ""}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="mt-1 w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Save profile
          </button>
        </form>
      </section>

      <section aria-label="Thresholds" className="max-w-md">
        <h2 className="font-display text-lg font-medium">Thresholds</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Minimum evidence and validation floors. Plane separation, the
          single-round validation pass, and the existence of approvals are not
          configurable.
        </p>
        <form action={saveConfigAction} className="mt-4 grid gap-3">
          <input type="hidden" name="workspaceId" value={params.ws} />
          <label className="text-xs font-medium">
            Minimum approved-evidence sample
            <input
              name="minBaselineN"
              type="number"
              defaultValue={config?.minBaselineN ?? 20}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Contested floor
            <input
              name="contestedFloor"
              type="number"
              step="0.05"
              defaultValue={config?.contestedFloor ?? 0.4}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Qualified floor
            <input
              name="qualifiedFloor"
              type="number"
              step="0.05"
              defaultValue={config?.qualifiedFloor ?? 0.7}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Similarity floor (retrieval relevance)
            <input
              name="similarityFloor"
              type="number"
              step="0.05"
              defaultValue={config?.similarityFloor ?? 0.35}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Prompt version
            <input
              name="promptVersion"
              type="number"
              min="1"
              step="1"
              defaultValue={config?.promptVersion ?? 1}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <fieldset className="text-xs font-medium">
            <legend className="mb-1">Analysis sequence (order preserved)</legend>
            <div className="grid grid-cols-2 gap-1">
              {ANALYSIS_STEPS.map((step) => (
                <label
                  key={step.value}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    name="analysisStep"
                    value={step.value}
                    defaultChecked={enabledSteps.has(step.value)}
                  />
                  {step.label}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            className="mt-1 w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Save configuration
          </button>
        </form>
      </section>

      <section aria-label="Alert rules" className="mt-8 max-w-2xl">
        <h2 className="font-display text-lg font-medium">Alert rules</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          In-app alerts on first-party outcome thresholds, evaluated hourly
          against the workspace minimum-N. Every delivery is recorded — sent,
          suppressed, or failed with the reason.
        </p>
        <form
          action={addAlertRuleAction}
          className="mt-3 flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3"
        >
          <input type="hidden" name="workspaceId" value={params.ws} />
          <input
            name="name"
            required
            placeholder="Rule name"
            className="min-w-40 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          />
          <select
            name="field"
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <option value="leads">Leads</option>
            <option value="qualifiedLeads">Qualified leads</option>
            <option value="conversionRate">Conversion rate</option>
            <option value="pipelineContribution">Pipeline</option>
            <option value="qualityScore">Quality score</option>
          </select>
          <select
            name="op"
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="eq">=</option>
          </select>
          <input
            name="value"
            type="number"
            step="any"
            required
            placeholder="0.3"
            className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          />
          <select
            name="severity"
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            Add rule
          </button>
        </form>
        {rules.length > 0 && (
          <ul className="mt-3 space-y-1">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span>
                  {r.name}
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {r.conditions
                      .map((c) => `${c.field} ${c.op} ${c.value}`)
                      .join(" · ")}{" "}
                    · {r.severity}
                  </span>
                </span>
                <form action={toggleAlertRuleAction}>
                  <input type="hidden" name="workspaceId" value={params.ws} />
                  <input type="hidden" name="ruleId" value={r.id} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={String(!r.enabled)}
                  />
                  <button
                    type="submit"
                    className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {r.enabled ? "Disable" : "Enable"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {deliveries.length > 0 && (
          <div className="mt-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Delivery ledger
            </h3>
            <ul className="mt-2 space-y-1">
              {deliveries.slice(0, 10).map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
                >
                  <span>
                    {rules.find((r) => r.id === d.ruleId)?.name ?? d.ruleId}
                  </span>
                  <span>
                    {d.status}
                    {d.reason ? ` — ${d.reason}` : ""} ·{" "}
                    {d.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-label="Configuration history" className="mt-8 max-w-2xl">
        <h2 className="font-display text-lg font-medium">
          Configuration history
        </h2>
        {configHistory.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No configuration changes recorded yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {configHistory.slice(0, 10).map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
              >
                <span>Configuration updated</span>
                <span>
                  {g.createdAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                  {g.approverId.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          Effective prompt version {config?.promptVersion ?? 1}
        </p>
      </section>
    </PlatinaPage>
  );
}
