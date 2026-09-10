import Link from "next/link";
import { listDrafts } from "@/db/queries/clients";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Creative Studio" };
export const dynamic = "force-dynamic";

export default async function StudioPage({
  params,
}: {
  params: { ws: string };
}) {
  const drafts = await listDrafts(params.ws);

  return (
    <PageShell width="app">
    <div>
      <p className="label-mono text-brand-teal">Creative Studio</p>
      <h1 className="mt-2 font-display text-4xl">Drafts</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Generated content lands here — open a draft to read it and refine it
        against the brand rules.
      </p>

      {drafts.length === 0 ? (
        <GlassCard className="mt-8 p-8 text-center">
          <p className="font-display text-xl">Nothing drafted yet</p>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Head to Ideation, generate ideas, and hit &quot;Draft it&quot;.
          </p>
        </GlassCard>
      ) : (
        <div className="mt-8 space-y-3">
          {drafts.map((draft) => (
            <Link
              key={draft.id}
              href={`/w/${params.ws}/studio/${draft.id}`}
              className="block"
            >
              <GlassCard className="flex items-center justify-between p-5 transition hover:border-brand-teal/40">
                <div>
                  <p className="font-display text-xl">{draft.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    {draft.createdAt.toISOString().slice(0, 10)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-border text-muted-foreground/70"
                >
                  {draft.status}
                </Badge>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
    </PageShell>
  );
}
