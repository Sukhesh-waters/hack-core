import Link from "next/link";
import { Plus } from "lucide-react";
import { listClients } from "@/db/queries/clients";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clientColor } from "@/lib/colors";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const rows = await listClients(params.ws);

  return (
    <PageShell width="app">
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="label-mono text-brand-teal">Clients</p>
          <h1 className="mt-2 font-display text-4xl">Client accounts</h1>
        </div>
        <Button asChild>
          <Link href={`/w/${params.ws}/clients/new`}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Add client
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <GlassCard className="mt-8 p-8 text-center">
          <p className="font-display text-xl">No clients yet</p>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Add your first client — the intake wizard captures their Brand
            DNA, and ideation runs on it from day one. Importing history is
            an optional add-on.
          </p>
        </GlassCard>
      ) : (
        <div className="mt-8 space-y-3">
          {rows.map((client) => (
            <GlassCard
              key={client.id}
              className="flex items-center justify-between p-5"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    clientColor(client.id).dot,
                  )}
                  aria-hidden
                />
                <div>
                  <Link
                    href={`/w/${params.ws}/clients/${client.id}`}
                    className="font-display text-xl hover:text-brand-teal hover:underline"
                  >
                    {client.name}
                  </Link>
                  {client.handle ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground/70">
                      {client.handle}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/w/${params.ws}/clients/${client.id}`}>
                    View
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link
                    href={`/w/${params.ws}/brand-gene?client=${client.id}`}
                  >
                    Brand DNA
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/w/${params.ws}/clients/${client.id}/import`}>
                    Import CSV (add-on)
                  </Link>
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
    </PageShell>
  );
}
