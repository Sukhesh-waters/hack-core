import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { listActivityForRun, loadSopRun } from "@/db/queries/sop";
import { RunBoard } from "./run-board";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "SOP run" };
export const dynamic = "force-dynamic";

export default async function SopRunPage({
  params,
}: {
  params: { ws: string; runId: string };
}) {
  const user = await requireUser();
  const [loaded, members] = await Promise.all([
    loadSopRun(params.ws, params.runId),
    listWorkspaceMembers(params.ws),
  ]);
  if (!loaded) notFound();

  const rawActivities = await listActivityForRun(
    params.ws,
    params.runId,
    loaded.steps.map((s) => s.id),
  );

  const activities = rawActivities.map((a) => ({
    id: a.id,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    actorId: a.actorId,
    actorName: a.actorName,
    verb: a.verb,
    meta: a.meta,
    createdAtIso: a.createdAt.toISOString(),
  }));

  return (
    <PageShell width="prose">
    <div>
      <Link
        href={`/w/${params.ws}/sop`}
        className="text-sm text-muted-foreground/70 hover:text-muted-foreground"
      >
        ← All SOPs
      </Link>
      <RunBoard
        workspaceId={params.ws}
        viewerId={user.id}
        run={loaded.run}
        steps={loaded.steps}
        activities={activities}
        members={members.map((m) => ({
          userId: m.userId,
          label: m.name ?? m.email ?? "Member",
        }))}
      />
    </div>
    </PageShell>
  );
}
