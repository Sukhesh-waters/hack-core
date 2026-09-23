import { listClients, listContentForClient } from "@/db/queries/clients";
import { GlassCard } from "@/components/glass-card";
import { CampaignWizard } from "./wizard";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "New campaign" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const clientsList = await listClients(params.ws);

  if (clientsList.length === 0) {
    return (
      <PageShell width="app">
        <p className="label-mono text-brand-teal">New campaign</p>
        <h1 className="mt-2 font-display text-3xl">No clients yet</h1>
        <GlassCard className="mt-8 p-8 text-center">
          <p className="text-sm text-muted-foreground/70">
            Add a client before launching a campaign.
          </p>
        </GlassCard>
      </PageShell>
    );
  }

  const contentLists = await Promise.all(
    clientsList.map((c) => listContentForClient(params.ws, c.id)),
  );
  const contentByClient = Object.fromEntries(
    clientsList.map((c, i) => [c.id, contentLists[i]]),
  );

  return (
    <PageShell width="app">
      <p className="label-mono text-brand-teal">New campaign</p>
      <h1 className="mt-2 font-display text-3xl">
        Launch through the approval gate
      </h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Every campaign is reviewed in Team Hub before it goes active — no
        live spend happens until approved.
      </p>
      <div className="mt-8">
        <CampaignWizard
          workspaceId={params.ws}
          clients={clientsList}
          contentByClient={contentByClient}
        />
      </div>
    </PageShell>
  );
}
