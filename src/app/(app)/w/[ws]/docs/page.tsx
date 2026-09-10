import Link from "next/link";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { listWorkspaceDocs } from "@/db/queries/workspace-docs";
import { GlassCard } from "@/components/glass-card";
import { NewDocForm } from "./new-doc-form";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Docs" };
export const dynamic = "force-dynamic";

function formatUpdatedDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function DocsPage({
  params,
}: {
  params: { ws: string };
}) {
  const [docs, members] = await Promise.all([
    listWorkspaceDocs(params.ws),
    listWorkspaceMembers(params.ws),
  ]);

  const memberById = new Map(members.map((m) => [m.userId, m]));
  const sops = docs.filter((doc) => doc.kind === "sop");
  const generalDocs = docs.filter((doc) => doc.kind !== "sop");

  return (
    <div>
      <p className="label-mono text-brand-teal">Docs</p>
      <h1 className="mt-2 font-display text-4xl">Lightweight internal docs</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground/70">
        Team-authored reference material — runbooks, SOPs, notes. Separate
        from the client Knowledge Base; nothing here is ingested or fed to
        the AI router.
      </p>

      <GlassCard className="mt-6 p-5">
        <p className="label-mono text-muted-foreground/70">New doc</p>
        <div className="mt-3">
          <NewDocForm workspaceId={params.ws} />
        </div>
      </GlassCard>

      {docs.length === 0 ? (
        <div className="mt-6">
          <GlassCard className="p-5">
            <p className="text-sm text-muted-foreground/70">
              No docs yet — create the first one above.
            </p>
          </GlassCard>
        </div>
      ) : (
        <>
          <DocSection
            heading="Standard Operating Procedures"
            docs={sops}
            memberById={memberById}
            workspaceSlug={params.ws}
            emptyLabel="No SOPs yet."
          />
          <DocSection
            heading="Docs"
            docs={generalDocs}
            memberById={memberById}
            workspaceSlug={params.ws}
            emptyLabel="No general docs yet."
          />
        </>
      )}
    </div>
  );
}

function DocSection({
  heading,
  docs,
  memberById,
  workspaceSlug,
  emptyLabel,
}: {
  heading: string;
  docs: Array<{
    id: string;
    slug: string;
    title: string;
    kind: "doc" | "sop" | "auto";
    updatedAt: Date;
    updatedById: string;
  }>;
  memberById: Map<string, { name: string | null; email: string }>;
  workspaceSlug: string;
  emptyLabel: string;
}) {
  return (
    <PageShell width="app">
      <div className="mt-8">
        <p className="label-mono text-muted-foreground/70">{heading}</p>
        <div className="mt-3 space-y-2">
          {docs.length === 0 ? (
            <p className="text-xs text-muted-foreground/50">{emptyLabel}</p>
          ) : (
            docs.map((doc) => {
              const updatedBy = memberById.get(doc.updatedById);
              return (
                <Link key={doc.id} href={`/w/${workspaceSlug}/docs/${doc.slug}`}>
                  <GlassCard className="p-4 transition hover:bg-accent">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {doc.title}
                        </p>
                        {doc.kind === "sop" ? (
                          <span className="rounded-full border border-brand-teal/40 bg-brand-teal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-teal">
                            SOP
                          </span>
                        ) : null}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground/50">
                        updated {formatUpdatedDate(doc.updatedAt)} by{" "}
                        {updatedBy?.name ?? updatedBy?.email ?? "a teammate"}
                      </p>
                    </div>
                  </GlassCard>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </PageShell>
  );
}
