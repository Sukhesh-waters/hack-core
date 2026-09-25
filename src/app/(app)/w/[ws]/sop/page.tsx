import Link from "next/link";
import { requireUser } from "@/auth";
import { listClients } from "@/db/queries/clients";
import { userCan } from "@/db/queries/memberships";
import {
  listSopRuns,
  listSopTemplates,
  sopRunProgress,
  sopStepCounts,
} from "@/db/queries/sop";
import { sopTemplateRunCounts } from "@/db/queries/sop-history";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { AiTemplateBuilder } from "./ai-template-builder";
import { NewTemplateForm } from "./new-template-form";
import { StartRunForm } from "./start-run-form";
import { SopListLive } from "./sop-list-live";
import { PageShell } from "@/components/page-shell";


export const metadata = { title: "SOPs" };
export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default async function SopPage(props: { params: Promise<{ ws: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  // Every list and count is one query; nothing here fans out per card.
  const [templates, canEdit, canRun, stepCounts, templateRunCountsMap, runs, progress, clients] =
    await Promise.all([
      listSopTemplates(params.ws),
      userCan(params.ws, user.id, "sop.template.edit"),
      userCan(params.ws, user.id, "sop.run.start"),
      sopStepCounts(params.ws),
      sopTemplateRunCounts(params.ws),
      listSopRuns(params.ws),
      sopRunProgress(params.ws),
      listClients(params.ws),
    ]);

  // A template with no steps can't produce a run, so it isn't offered as one.
  const runnable = templates.filter((t) => (stepCounts.get(t.id) ?? 0) > 0);
  const activeRuns = runs.filter((r) => r.status === "active");
  const pastRuns = runs.filter((r) => r.status !== "active");

  return (
    <PageShell width="app">
      <div>
        <p className="label-mono text-brand-teal">SOPs</p>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-display text-4xl">Repeatable process</h1>
          <SopListLive workspaceId={params.ws} />
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground/70">
          A template defines a dated, assigned, dependency-ordered run — not a
          checklist. Give it a start date and it produces real work with owners
          and due dates. For prose runbooks, use{" "}
          <Link
            href={`/w/${params.ws}/docs`}
            className="text-brand-teal hover:underline"
          >
            Docs
          </Link>
          .
        </p>

        {canRun && runnable.length > 0 ? (
          <GlassCard className="mt-6 p-5">
            <p className="label-mono text-muted-foreground/70">Start a run</p>
            <div className="mt-3">
              <StartRunForm
                workspaceId={params.ws}
                templates={runnable.map((t) => ({
                  id: t.id,
                  name: t.name,
                  anchorLabel: t.anchorLabel,
                }))}
                clients={clients.map((c) => ({ id: c.id, name: c.name }))}
              />
            </div>
          </GlassCard>
        ) : null}

        <h2 className="mt-10 font-display text-2xl">Active runs</h2>
        <div className="mt-3 space-y-3">
          {activeRuns.length === 0 ? (
            <GlassCard className="p-6 text-center">
              <p className="text-sm text-muted-foreground/70">
                Nothing running right now.
              </p>
            </GlassCard>
          ) : (
            activeRuns.map((run) => {
              const p = progress.get(run.id);
              return (
                <Link
                  key={run.id}
                  href={`/w/${params.ws}/sop/runs/${run.id}`}
                  className="block"
                >
                  <GlassCard className="p-5 transition-colors hover:bg-accent">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-xl">{run.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground/70">
                          {run.clientName ? `${run.clientName} · ` : ""}
                          anchored to {formatDate(run.anchorDate)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {p && p.overdue > 0 ? (
                          <Badge
                            variant="outline"
                            className="border-amber-400/40 text-amber-300"
                          >
                            {p.overdue} overdue
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className="border-border text-muted-foreground/70"
                        >
                          {p ? `${p.closed}/${p.total} done` : "—"}
                        </Badge>
                      </div>
                    </div>
                  </GlassCard>
                </Link>
              );
            })
          )}
        </div>

        {pastRuns.length > 0 ? (
          <>
            <h2 className="mt-10 font-display text-2xl">Finished</h2>
            <div className="mt-3 space-y-2">
              {pastRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/w/${params.ws}/sop/runs/${run.id}`}
                  className="block"
                >
                  <GlassCard className="p-4 transition-colors hover:bg-accent">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-muted-foreground">{run.name}</p>
                      <Badge
                        variant="outline"
                        className="border-border text-muted-foreground/70"
                      >
                        {run.status}
                      </Badge>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        <h2 className="mt-10 font-display text-2xl">Templates</h2>
        {canEdit ? (
          <div className="mt-3 space-y-3">
            <GlassCard className="p-5">
              <div className="flex items-center justify-between">
                <p className="label-mono text-muted-foreground/70">New template</p>
              </div>
              <div className="mt-3">
                <NewTemplateForm workspaceId={params.ws} />
              </div>
            </GlassCard>
            <AiTemplateBuilder workspaceId={params.ws} />
          </div>
        ) : null}

        <div className="mt-3 space-y-3">
          {templates.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <p className="font-display text-xl">No templates yet</p>
              <p className="mt-2 text-sm text-muted-foreground/70">
                {canEdit
                  ? "Create one above — a campaign launch, a monthly content cycle, a client onboarding."
                  : "An admin hasn't set any up yet."}
              </p>
            </GlassCard>
          ) : (
            templates.map((template) => {
              const steps = stepCounts.get(template.id) ?? 0;
              const runCount = templateRunCountsMap.get(template.id) ?? 0;
              return (
                <Link
                  key={template.id}
                  href={`/w/${params.ws}/sop/${template.id}`}
                  className="block"
                >
                  <GlassCard className="p-5 transition-colors hover:bg-accent">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-xl">{template.name}</p>
                        {template.description ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {template.description}
                          </p>
                        ) : null}
                        <p className="mt-2 text-xs text-muted-foreground/70">
                          Runs count from{" "}
                          <span className="text-muted-foreground">
                            {template.anchorLabel}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {runCount > 0 ? (
                          <Badge
                            variant="outline"
                            className="border-brand-teal/40 text-brand-teal"
                          >
                            {runCount} {runCount === 1 ? "run" : "runs"}
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={
                            steps === 0
                              ? "border-amber-400/30 text-amber-300"
                              : "border-border text-muted-foreground/70"
                          }
                        >
                          {steps === 0
                            ? "No steps yet"
                            : `${steps} step${steps === 1 ? "" : "s"}`}
                        </Badge>
                      </div>
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
