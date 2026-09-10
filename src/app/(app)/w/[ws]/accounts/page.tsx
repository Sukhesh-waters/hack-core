import { listConnectedAccounts } from "@/db/queries/accounts";
import { listClients } from "@/db/queries/clients";
import { apifyConfigured, metaConnectorEnabled } from "@/lib/flags";
import { getFreshness } from "@/lib/freshness";
import { GlassCard } from "@/components/glass-card";
import { AccountCard, type AccountView } from "./account-card";
import { ConnectForm } from "./connect-form";
import { PatternForm } from "./pattern-form";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Connected accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage({
  params,
}: {
  params: { ws: string };
}) {
  const [accounts, clients] = await Promise.all([
    listConnectedAccounts(params.ws),
    listClients(params.ws),
  ]);
  const metaEnabled = metaConnectorEnabled();
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));

  const views: AccountView[] = accounts.map((account) => ({
    id: account.id,
    clientName: clientNames.get(account.clientId) ?? "Unknown client",
    igUserId: account.igUserId,
    status: account.status,
    freshness: getFreshness(account.lastPullAt),
    lastError: account.lastError,
    metaEnabled,
  }));

  return (
    <PageShell width="app">
    <div>
      <p className="label-mono text-brand-teal">Connected accounts</p>
      <h1 className="mt-2 font-display text-4xl">Data connections</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        First-party pulls feed the baseline engine. Public pages feed the
        separate pattern layer. The two never mix.
      </p>

      {views.length > 0 ? (
        <div className="mt-8 space-y-3">
          {views.map((account) => (
            <AccountCard
              key={account.id}
              workspaceId={params.ws}
              account={account}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-6">
          <p className="label-mono text-brand-teal">
            First-party · Meta connector
          </p>
          {!metaEnabled ? (
            <p className="mt-2 text-sm text-brand-amber">
              Awaiting Meta app review — connections can be saved now, syncs
              unlock when META_CONNECTOR_ENABLED=true.
            </p>
          ) : null}
          <div className="mt-4">
            <ConnectForm workspaceId={params.ws} clients={clients} />
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <p className="label-mono text-brand-purple">
            Pattern layer · public pages
          </p>
          {apifyConfigured() ? (
            <div className="mt-4">
              <PatternForm workspaceId={params.ws} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground/70">
              Set <code className="font-mono">APIFY_TOKEN</code> in{" "}
              <code className="font-mono">.env.local</code> to enable public
              pattern ingestion.
            </p>
          )}
        </GlassCard>
      </div>
    </div>
    </PageShell>
  );
}
