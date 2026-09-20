import { listClients } from "@/db/queries/clients";
import { listActiveGoalsForClient } from "@/db/queries/client-goals";
import { listIdeas } from "@/db/queries/ideas";
import { getPostsByIds } from "@/db/queries/posts";
import { GlassCard } from "@/components/glass-card";
import { DECLARED_ONLY_REASON } from "@/lib/ai/agents/strategy";
import { IdeaPool } from "./idea-pool";
import type { IdeaView } from "./idea-card";
import { TopicForm, type GoalOption } from "./topic-form";
import { KbNudge } from "./kb-nudge";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Ideation" };
export const dynamic = "force-dynamic";

export default async function IdeationPage({
  params,
}: {
  params: { ws: string };
}) {
  const [clients, ideaRows] = await Promise.all([
    listClients(params.ws),
    listIdeas(params.ws, { limit: 18 }),
  ]);

  // G1 — active goals per client, for the optional goal picker. A handful
  // of clients at this scale (4-client agency); one query per client is
  // cheap and avoids adding a fetch-on-select round trip to the form.
  const goalLists = await Promise.all(
    clients.map((c) => listActiveGoalsForClient(params.ws, c.id)),
  );
  const goalsByClientId: Record<string, GoalOption[]> = {};
  clients.forEach((client, i) => {
    goalsByClientId[client.id] = goalLists[i].map((g) => ({
      id: g.id,
      title: g.title,
      hypothesis: g.hypothesis,
    }));
  });

  // Resolve citation ids → first-party captions in one scoped query
  const allCited = Array.from(
    new Set(ideaRows.flatMap((idea) => idea.citations ?? [])),
  );
  const citedPosts = await getPostsByIds(params.ws, allCited);
  const captionById = new Map(
    citedPosts.map((post) => [post.id, post.caption ?? "no caption"]),
  );

  const views: IdeaView[] = ideaRows.map((idea) => ({
    id: idea.id,
    hook: idea.hook,
    angle: idea.angle,
    format: idea.format,
    whyReason: idea.whyReason,
    citedCaptions: (idea.citations ?? [])
      .map((id) => captionById.get(id))
      .filter((c): c is string => Boolean(c)),
    status: idea.status,
    isDeclaredOnly: idea.whyReason === DECLARED_ONLY_REASON,
  }));

  const activeClientId = clients[0]?.id ?? "";

  return (
    <PageShell width="app">
    <div>
      <p className="label-mono text-brand-teal">Ideation</p>
      <h1 className="mt-2 font-display text-4xl">
        What should this account post next?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Ideas are grounded in a driver brief built from this client&apos;s own
        baseline — every &quot;why&quot; cites first-party rows only.
      </p>

      <div className="mt-6">
        <KbNudge workspaceId={params.ws} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <GlassCard className="h-fit p-6">
          <TopicForm
            workspaceId={params.ws}
            clients={clients}
            goalsByClientId={goalsByClientId}
          />
        </GlassCard>

        <div className="space-y-4 lg:col-span-2">
          {views.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <p className="font-display text-xl">No ideas yet</p>
              <p className="mt-2 text-sm text-muted-foreground/70">
                Pick a client with a ready Brand DNA and a scored baseline,
                give it a topic, and the ideation agent does the rest.
              </p>
            </GlassCard>
          ) : (
            <IdeaPool
              workspaceId={params.ws}
              clientId={activeClientId}
              ideas={views}
            />
          )}
        </div>
      </div>
    </div>
    </PageShell>
  );
}
