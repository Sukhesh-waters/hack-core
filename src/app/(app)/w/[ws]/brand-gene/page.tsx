import Link from "next/link";
import { redirect } from "next/navigation";
import { listClients } from "@/db/queries/clients";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClientSelect } from "./client-select";
import { IdentityTab } from "./identity-tab";
import { KnowledgeTab } from "./knowledge-tab";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Brand Gene" };
export const dynamic = "force-dynamic";

export default async function BrandGenePage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ client?: string; tab?: string; q?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const clientsList = await listClients(params.ws);

  if (clientsList.length === 0) {
    return (
      <PageShell width="app">
        <p className="label-mono text-brand-teal">Brand Gene</p>
        <h1 className="mt-2 font-display text-4xl">No clients yet</h1>
        <GlassCard className="mt-8 p-8 text-center">
          <p className="text-sm text-muted-foreground/70">
            Add your first client — the intake wizard captures their Brand
            DNA from day one.
          </p>
          <Button asChild className="mt-4">
            <Link href={`/w/${params.ws}/clients/new`}>Add client</Link>
          </Button>
        </GlassCard>
      </PageShell>
    );
  }

  const active =
    clientsList.find((c) => c.id === searchParams.client) ?? clientsList[0];
  if (active.id !== searchParams.client) {
    redirect(`/w/${params.ws}/brand-gene?client=${active.id}`);
  }

  const tab = searchParams.tab === "knowledge" ? "knowledge" : "identity";

  return (
    <PageShell width="app">
      <p className="label-mono text-brand-teal">Brand Gene</p>
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl">{active.name}</h1>
        <ClientSelect
          workspaceId={params.ws}
          clients={clientsList}
          activeId={active.id}
          tab={tab}
        />
      </div>

      <div className="mt-6 flex gap-2">
        <Link
          href={`/w/${params.ws}/brand-gene?client=${active.id}&tab=identity`}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition",
            tab === "identity"
              ? "bg-accent text-foreground"
              : "text-muted-foreground/70 hover:text-foreground",
          )}
        >
          Identity
        </Link>
        <Link
          href={`/w/${params.ws}/brand-gene?client=${active.id}&tab=knowledge`}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition",
            tab === "knowledge"
              ? "bg-accent text-foreground"
              : "text-muted-foreground/70 hover:text-foreground",
          )}
        >
          Knowledge
        </Link>
      </div>

      {tab === "identity" ? (
        <IdentityTab workspaceId={params.ws} clientId={active.id} />
      ) : (
        <KnowledgeTab
          workspaceId={params.ws}
          clientId={active.id}
          query={searchParams.q}
        />
      )}
    </PageShell>
  );
}
