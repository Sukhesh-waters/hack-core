import Link from "next/link";
import { notFound } from "next/navigation";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { getWorkspaceDocBySlug } from "@/db/queries/workspace-docs";
import { GlassCard } from "@/components/glass-card";
import { DocDetail } from "./doc-detail";
import { RenderedDocBody } from "./rendered-doc-body";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Doc" };
export const dynamic = "force-dynamic";

export default async function DocDetailPage({
  params,
}: {
  params: { ws: string; slug: string };
}) {
  const doc = await getWorkspaceDocBySlug(params.ws, params.slug);
  if (!doc) notFound();

  const members = await listWorkspaceMembers(params.ws);
  const updatedBy = members.find((m) => m.userId === doc.updatedById);

  return (
    <PageShell width="prose">
      <Link
        href={`/w/${params.ws}/docs`}
        className="text-xs text-muted-foreground/70 hover:text-foreground"
      >
        ← All docs
      </Link>

      <GlassCard className="mt-4 p-6">
        <DocDetail
          workspaceId={params.ws}
          docId={doc.id}
          title={doc.title}
          body={doc.body}
          renderedBody={<RenderedDocBody body={doc.body} />}
          kind={doc.kind}
          updatedAtLabel={doc.updatedAt.toLocaleString()}
          updatedByLabel={updatedBy?.name ?? updatedBy?.email ?? "a teammate"}
        />
      </GlassCard>
    </PageShell>
  );
}
