import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { content } from "@/db/schema";
import { userCan } from "@/db/queries/memberships";
import { loadContentWorkflow } from "@/db/queries/workflow";
import { orderedStates } from "@/lib/workflow/engine";
import { WorkflowAdmin, type AdminStateView } from "./workflow-admin";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Workflows" };
export const dynamic = "force-dynamic";

export default async function WorkflowsPage({
  params,
}: {
  params: { ws: string };
}) {
  const user = await requireUser();
  const [workflow, canEdit] = await Promise.all([
    loadContentWorkflow(params.ws),
    userCan(params.ws, user.id, "workflow.edit"),
  ]);

  // Counts come from one grouped query rather than one per state — the
  // admin needs them to know what a delete or a WIP limit would affect.
  const counts = await db
    .select({
      stateId: content.workflowStateId,
      count: sql<number>`count(*)::int`,
    })
    .from(content)
    .where(
      and(
        eq(content.workspaceId, params.ws),
        sql`${content.workflowStateId} IS NOT NULL`,
      ),
    )
    .groupBy(content.workflowStateId)
    .limit(200);
  const countByState = new Map(counts.map((c) => [c.stateId, c.count]));

  const states: AdminStateView[] = orderedStates(workflow).map((state) => ({
    id: state.id,
    key: state.key,
    name: state.name,
    category: state.category,
    colorKey: state.colorKey,
    position: state.position,
    wipLimit: state.wipLimit,
    isSeeded: state.legacyStage !== null,
    cardCount: countByState.get(state.id) ?? 0,
  }));

  return (
    <PageShell width="app">
      <p className="label-mono text-brand-teal">Workflows</p>
      <h1 className="mt-2 font-display text-4xl">Your process, not ours</h1>

      <div className="mt-8">
        <WorkflowAdmin
          workspaceId={params.ws}
          workflowName={workflow.name}
          states={states}
          transitions={workflow.transitions.map((t) => ({
            id: t.id,
            fromStateId: t.fromStateId,
            toStateId: t.toStateId,
            name: t.name,
            conditions: t.conditions,
            validators: t.validators,
            postActions: t.postActions,
          }))}
          canEdit={canEdit}
        />
      </div>
    </PageShell>
  );
}
