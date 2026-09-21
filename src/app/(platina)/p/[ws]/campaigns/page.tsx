import { PlatinaMovedNotice } from "@/components/platina/moved-notice";
import { PlatinaPage } from "@/components/platina/page";
import { listCampaigns } from "@/db/queries/platina";
import { publishCampaignAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  params,
}: {
  params: { ws: string };
}) {
  const campaigns = await listCampaigns(params.ws);

  return (
    <PlatinaPage eyebrow="Campaigns" title="Campaigns">
      <PlatinaMovedNotice
        workspaceId={params.ws}
        to="solutions"
        label="Solutions"
      />
      <ul className="space-y-3">
        {campaigns.map((c) => (
          <li key={c.id} className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{c.title}</p>
            <p className="text-muted-foreground">
              {c.durationDays}d · {c.geography} · {c.channelMix.join(", ")}
            </p>
            <p className="mt-1 text-xs">{c.contentPlan}</p>
            <form action={publishCampaignAction} className="mt-2">
              <input type="hidden" name="workspaceId" value={params.ws} />
              <input type="hidden" name="campaignId" value={c.id} />
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
              >
                Approve to ship
              </button>
            </form>
          </li>
        ))}
      </ul>
    </PlatinaPage>
  );
}
