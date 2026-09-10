import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { listNewIdeas } from "@/db/queries/ideas";
import { getPostsByIds } from "@/db/queries/posts";
import { loadContentWorkflow } from "@/db/queries/workflow";
import { GlassCard } from "@/components/glass-card";
import { PlanCard, type PlanIdeaView } from "./plan-card";
import { PageShell } from "@/components/page-shell";
import { nextStepChipText } from "@/lib/plan/next-step";

export const metadata = { title: "Plan & Validate" };
export const dynamic = "force-dynamic";

export default async function PlanPage({
  params,
}: {
  params: { ws: string };
}) {
  // Must resolve — and reject — before anything below runs. loadContentWorkflow
  // lazily SEEDS work_types/workflows on first read for this workspace id; the
  // workspace layout also guards this route, but its check runs concurrently
  // with this page's data fetching rather than strictly before it, so relying
  // on the layout alone let a nonexistent workspace id reach the seed insert
  // and trip the work_types FK constraint. Checking membership here first,
  // awaited on its own (not folded into the Promise.all below), closes that
  // ordering gap. Mirrors the try/catch -> notFound() shape in ./layout.tsx.
  const user = await requireUser();
  try {
    await requireMembership(params.ws, user.id);
  } catch {
    notFound();
  }

  const [ideaRows, workflow] = await Promise.all([
    listNewIdeas(params.ws),
    loadContentWorkflow(params.ws),
  ]);
  const pipelineChip = nextStepChipText(workflow);

  // Resolve citation ids → first-party captions in one scoped query
  const allCited = Array.from(
    new Set(ideaRows.flatMap((idea) => idea.citations ?? [])),
  );
  const citedPosts = await getPostsByIds(params.ws, allCited);
  const captionById = new Map(
    citedPosts.map((post) => [post.id, post.caption ?? "no caption"]),
  );

  const views: PlanIdeaView[] = ideaRows.map((idea) => ({
    id: idea.id,
    clientId: idea.clientId,
    clientName: idea.clientName,
    topic: idea.topic,
    hook: idea.hook,
    angle: idea.angle,
    format: idea.format,
    whyReason: idea.whyReason,
    citedCaptions: (idea.citations ?? [])
      .map((id) => captionById.get(id))
      .filter((c): c is string => Boolean(c)),
    // listNewIdeas only ever returns status="new" rows — the query is
    // filtered server-side, so this is never stale, just not re-selected.
    status: "new",
  }));

  return (
    <PageShell width="app">
    <div>
      <p className="label-mono text-brand-teal">Plan & Validate</p>
      <h1 className="mt-2 font-display text-4xl">Proposed slots</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Every proposed slot cites baseline rows only — accept, edit, or
        reject with a reason.
      </p>

      <div className="mt-8 space-y-4">
        {views.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="font-display text-xl">No proposed ideas</p>
            <p className="mt-2 text-sm text-muted-foreground/70">
              Generate some in{" "}
              <Link
                href={`/w/${params.ws}/ideation`}
                className="text-brand-teal hover:underline"
              >
                Ideation
              </Link>{" "}
              — newly generated ideas land here for accept, edit, or reject.
            </p>
          </GlassCard>
        ) : (
          views.map((idea) => (
            <PlanCard key={idea.id} workspaceId={params.ws} idea={idea} pipelineChip={pipelineChip} />
          ))
        )}
      </div>
    </div>
    </PageShell>
  );
}
