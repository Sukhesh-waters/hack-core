import { listClients } from "@/db/queries/clients";
import { listClientGoals, listActiveGoalsForClient } from "@/db/queries/client-goals";
import { listDecisions } from "@/db/queries/decisions";
import { listInsights } from "@/db/queries/insights";
import { firstPartyPostsForClientQuery } from "@/db/queries/posts";
import { getPostsByIds } from "@/db/queries/posts";
import { GlassCard } from "@/components/glass-card";
import { DecisionCard, type DecisionView } from "./decision-card";
import {
  NewDecisionForm,
  type ClientOption,
  type EvidencePostOption,
  type GoalOption,
  type InsightOption,
} from "./new-decision-form";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Decisions" };
export const dynamic = "force-dynamic";

export default async function DecisionsPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const [clients, decisionRows, insightRows] = await Promise.all([
    listClients(params.ws),
    listDecisions(params.ws),
    listInsights(params.ws),
  ]);

  // Per-client goals (all statuses, for resolving a decision's goalTitle
  // regardless of whether it's since been marked achieved/abandoned) and
  // first-party posts (for the evidence picker) — a handful of clients at
  // this scale, so one query per client per list is cheap.
  const [goalLists, postLists] = await Promise.all([
    Promise.all(clients.map((c) => listClientGoals(params.ws, c.id))),
    Promise.all(
      clients.map((c) => firstPartyPostsForClientQuery(params.ws, c.id)),
    ),
  ]);

  const activeGoalLists = await Promise.all(
    clients.map((c) => listActiveGoalsForClient(params.ws, c.id)),
  );

  const clientById = new Map(clients.map((c) => [c.id, c.name]));
  const goalTitleById = new Map<string, string>();
  const goalsByClientId: Record<string, GoalOption[]> = {};
  const postsByClientId: Record<string, EvidencePostOption[]> = {};
  clients.forEach((client, i) => {
    for (const g of goalLists[i]) goalTitleById.set(g.id, g.title);
    goalsByClientId[client.id] = activeGoalLists[i].map((g) => ({
      id: g.id,
      title: g.title,
      hypothesis: g.hypothesis,
    }));
    postsByClientId[client.id] = postLists[i].map((p) => ({
      id: p.id,
      caption: p.caption,
    }));
  });

  const insightById = new Map(
    insightRows.map((i) => [i.id, { pattern: i.pattern, suggestion: i.suggestion }]),
  );

  // Resolve every cited first-party post id -> caption in one scoped query,
  // same pattern as the ideation page's citation resolution.
  const allEvidenceIds = Array.from(
    new Set(decisionRows.flatMap((d) => d.evidencePostIds)),
  );
  const evidencePosts = await getPostsByIds(params.ws, allEvidenceIds);
  const captionById = new Map(
    evidencePosts.map((p) => [p.id, p.caption ?? "(no caption)"]),
  );

  const views: DecisionView[] = decisionRows.map((d) => ({
    id: d.id,
    title: d.title,
    reason: d.reason,
    expectedOutcome: d.expectedOutcome,
    reviewAt: d.reviewAt,
    outcome: d.outcome,
    outcomeNote: d.outcomeNote,
    clientName: d.clientId ? (clientById.get(d.clientId) ?? null) : null,
    goalTitle: d.goalId ? (goalTitleById.get(d.goalId) ?? null) : null,
    evidenceCaptions: d.evidencePostIds
      .map((id) => captionById.get(id))
      .filter((c): c is string => Boolean(c)),
    insight: d.insightId ? (insightById.get(d.insightId) ?? null) : null,
  }));

  const clientOptions: ClientOption[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const insightOptions: InsightOption[] = insightRows.map((i) => ({
    id: i.id,
    pattern: i.pattern,
    suggestion: i.suggestion,
  }));

  return (
    <PageShell width="prose">
    <div>
      <p className="label-mono text-brand-teal">Decisions</p>
      <h1 className="mt-2 font-display text-4xl">What we chose, and why</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground/70">
        The causal counterpart to the statistical loop — what a human chose
        to do, on what evidence, and (after review) whether it worked.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <GlassCard className="h-fit p-6">
          <p className="label-mono text-muted-foreground/70">Record a decision</p>
          <div className="mt-3">
            <NewDecisionForm
              workspaceId={params.ws}
              clients={clientOptions}
              goalsByClientId={goalsByClientId}
              postsByClientId={postsByClientId}
              insights={insightOptions}
            />
          </div>
        </GlassCard>

        <div className="space-y-4 lg:col-span-2">
          {views.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <p className="font-display text-xl">No decisions yet</p>
              <p className="mt-2 text-sm text-muted-foreground/70">
                Record a decision to start building a track record of what
                actually worked.
              </p>
            </GlassCard>
          ) : (
            views.map((decision) => (
              <DecisionCard
                key={decision.id}
                workspaceId={params.ws}
                decision={decision}
              />
            ))
          )}
        </div>
      </div>
    </div>
    </PageShell>
  );
}
