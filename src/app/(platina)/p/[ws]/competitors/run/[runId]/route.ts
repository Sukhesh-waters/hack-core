import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getAuditRun, getScanSpec, listAuditRunEvents } from "@/db/queries/platina";

export const dynamic = "force-dynamic";

/**
 * One run's live timeline for the "read it now" panel (C8.2): status, each
 * recorded step, counters. Workspace-scoped: another workspace's run id is
 * simply not found.
 */
export async function GET(_request: Request, props: { params: Promise<{ ws: string; runId: string }> }) {
  const { ws, runId } = await props.params;
  const user = await requireUser();
  await requireMembership(ws, user.id);
  const run = await getAuditRun(ws, runId);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [events, spec] = await Promise.all([
    listAuditRunEvents(ws, runId),
    run.specId ? getScanSpec(ws, run.specId) : Promise.resolve(null),
  ]);
  return NextResponse.json(
    {
      status: run.status,
      source: spec ? { name: spec.name, url: spec.targets[0]?.value ?? null } : null,
      counters: run.counters ?? null,
      reason: run.degradedReason ?? run.errorReason ?? null,
      steps: events.map((e) => ({ status: e.status, message: e.message, at: e.createdAt })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
