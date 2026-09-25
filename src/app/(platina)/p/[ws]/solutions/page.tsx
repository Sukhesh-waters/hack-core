import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { solutionsQuery } from "@/db/queries/platina";
import {
  editSolutionAction,
  publishCampaignAction,
  rejectSolutionAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina solutions" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft — in review",
  planned: "Planned",
  active: "Active",
  closed: "Closed",
};

const USE_CASE_LABEL: Record<string, string> = {
  competitor_change: "Competitor / market change",
  event_readiness: "Event readiness",
  brand_drift: "Brand drift",
  claims: "Claims",
  campaign_performance: "Campaign performance",
};

export default async function SolutionsPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const rows = await solutionsQuery(params.ws);

  return (
    <PlatinaPage
      eyebrow="Platina · Solutions"
      title="Solutions"
      description="Approved responses to findings. Final approval marks a solution ready for external execution — Platina exports the action packet; it never publishes into a Waters system."
    >
      <PlatinaFormError message={searchParams.error} />
      <div className="mb-6">
        <Link
          href={`/p/${params.ws}/solutions/new`}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          New solution from evidence
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
          No solutions yet. Start one from approved evidence and derived
          hypotheses.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ campaign: c, receipt: r }) => (
            <li
              key={c.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Link
                    href={`/p/${params.ws}/solutions/${c.id}`}
                    className="font-medium hover:underline"
                  >
                    {c.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {[
                      c.useCase ? USE_CASE_LABEL[c.useCase] ?? c.useCase : null,
                      c.durationDays ? `${c.durationDays}d` : null,
                      c.geography,
                      c.channelMix.length > 0 ? c.channelMix.join(", ") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r?.severity && (
                    <span className="rounded bg-secondary px-2 py-0.5 font-mono text-[11px] text-secondary-foreground">
                      {r.severity}
                    </span>
                  )}
                  <span className="rounded bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground">
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </div>
              </div>

              {r ? (
                <dl className="mt-3 grid gap-2 rounded-md bg-secondary p-3 text-xs md:grid-cols-2">
                  <div>
                    <dt className="font-medium text-secondary-foreground">
                      Expected outcome
                    </dt>
                    <dd className="text-muted-foreground">
                      {r.expectedOutcome}
                    </dd>
                  </div>
                  {r.strongestUncertainty ? (
                    <div>
                      <dt className="font-medium text-secondary-foreground">
                        Strongest uncertainty
                      </dt>
                      <dd className="text-muted-foreground">
                        {r.strongestUncertainty}
                      </dd>
                    </div>
                  ) : null}
                  {r.measurementMethod ? (
                    <div>
                      <dt className="font-medium text-secondary-foreground">
                        Measurement
                      </dt>
                      <dd className="text-muted-foreground">
                        {r.measurementMethod}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="font-medium text-secondary-foreground">
                      Review due
                    </dt>
                    <dd className="font-mono text-muted-foreground">
                      {r.reviewAt.toISOString().slice(0, 10)}
                    </dd>
                  </div>
                </dl>
              ) : null}

              {c.contentPlan ? (
                <p className="mt-2 text-sm">{c.contentPlan}</p>
              ) : null}

              {c.status === "draft" && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      Edit plan
                    </summary>
                    <form
                      action={editSolutionAction}
                      className="mt-2 grid gap-2 md:grid-cols-2"
                    >
                      <input type="hidden" name="workspaceId" value={params.ws} />
                      <input type="hidden" name="campaignId" value={c.id} />
                      <input
                        name="durationDays"
                        type="number"
                        defaultValue={c.durationDays ?? undefined}
                        placeholder="Duration (days)"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      />
                      <input
                        name="geography"
                        defaultValue={c.geography ?? ""}
                        placeholder="Geography"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      />
                      <input
                        name="channelMix"
                        defaultValue={c.channelMix.join(", ")}
                        placeholder="Channels, comma-separated"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      />
                      <input
                        name="audience"
                        defaultValue={c.audience ?? ""}
                        placeholder="Audience"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      />
                      <textarea
                        name="contentPlan"
                        defaultValue={c.contentPlan ?? ""}
                        rows={2}
                        placeholder="Content plan"
                        className="rounded-md border border-input bg-background p-2 text-xs md:col-span-2"
                      />
                      <button
                        type="submit"
                        className="w-fit rounded-md border border-border px-3 py-1.5 text-xs"
                      >
                        Save plan edits
                      </button>
                    </form>
                  </details>
                  <div className="flex items-center gap-2">
                    <form action={publishCampaignAction}>
                      <input type="hidden" name="workspaceId" value={params.ws} />
                      <input type="hidden" name="campaignId" value={c.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                      >
                        Approve — ready for external execution
                      </button>
                    </form>
                    <form action={rejectSolutionAction} className="flex gap-1">
                      <input type="hidden" name="workspaceId" value={params.ws} />
                      <input type="hidden" name="campaignId" value={c.id} />
                      <input
                        name="reason"
                        required
                        placeholder="Rejection reason"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PlatinaPage>
  );
}
