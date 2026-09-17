import Link from "next/link";
import { PlatinaPage } from "@/components/platina/page";
import { listCampaigns } from "@/db/queries/platina";
import { publishCampaignAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina solutions" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Awaiting final approval",
  planned: "Planned",
  active: "Active",
  closed: "Closed",
};

export default async function SolutionsPage({
  params,
}: {
  params: { ws: string };
}) {
  const campaigns = await listCampaigns(params.ws);

  return (
    <PlatinaPage
      eyebrow="Platina · Solutions"
      title="Solutions"
      description="Approved responses to findings. Final approval marks a solution ready for external execution — Platina exports the action packet; it never publishes into a Waters system."
    >
      <div className="mb-6">
        <Link
          href={`/p/${params.ws}/solutions/new`}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          New solution from evidence
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
          No solutions yet. Start one from approved evidence and derived
          hypotheses.
        </div>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{c.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {c.durationDays}d · {c.geography} ·{" "}
                    {c.channelMix.join(", ")}
                  </p>
                </div>
                <span className="rounded bg-secondary px-2 py-0.5 font-mono text-[11px] text-secondary-foreground">
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </div>
              {c.contentPlan ? (
                <p className="mt-2 text-sm">{c.contentPlan}</p>
              ) : null}
              {c.status === "draft" && (
                <form action={publishCampaignAction} className="mt-3">
                  <input type="hidden" name="workspaceId" value={params.ws} />
                  <input type="hidden" name="campaignId" value={c.id} />
                  <button
                    type="submit"
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                  >
                    Approve — ready for external execution
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </PlatinaPage>
  );
}
