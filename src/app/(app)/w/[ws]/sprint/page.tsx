import Link from "next/link";
import { requireUser } from "@/auth";
import { listClients } from "@/db/queries/clients";
import { listSprintsQuery } from "@/db/queries/sprint";
import { listSopTemplates } from "@/db/queries/sop";
import { PageShell } from "@/components/page-shell";
import { LaunchSprintDialog } from "./launch-sprint-dialog";
import { Sparkles, Calendar, ChevronRight, Rocket } from "lucide-react";

export const metadata = { title: "Campaign Sprints | InstaMedia AI" };
export const dynamic = "force-dynamic";

export default async function SprintIndexPage({
  params,
}: {
  params: { ws: string };
}) {
  await requireUser();
  const [clientsList, sprints, templates] = await Promise.all([
    listClients(params.ws),
    listSprintsQuery(params.ws),
    listSopTemplates(params.ws),
  ]);

  const templateOptions = templates.map((t) => ({
    id: t.id,
    name: t.name,
  }));

  return (
    <PageShell width="app">
      <div className="space-y-8">
        {/* Hero Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-8 rounded-2xl bg-card border border-border shadow-xl">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-teal-400 font-mono text-xs font-semibold tracking-wider uppercase">
              <Sparkles className="w-4 h-4 text-teal-300 animate-pulse" />
              <span>Autopilot Campaign Production</span>
            </div>
            <h1 className="text-3xl font-display text-foreground">
              Campaign Sprints
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              1-Click agency factory: Select a client & theme $\rightarrow$ AI generates hooks, multi-format drafts, brand compliance audits, and calendar slots in 60 seconds.
            </p>
          </div>

          <div>
            <LaunchSprintDialog
              workspaceId={params.ws}
              clients={clientsList.map((c) => ({
                id: c.id,
                name: c.name,
                handle: c.handle,
              }))}
              templates={templateOptions}
            />
          </div>
        </div>

        {/* Sprints List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-mono font-semibold uppercase tracking-wider text-muted-foreground">
              Active & Recent Sprints ({sprints.length})
            </h2>
          </div>

          {sprints.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-card border border-dashed border-border space-y-4">
              <div className="w-12 h-12 rounded-full bg-teal-500/10 text-teal-400 flex items-center justify-center mx-auto border border-teal-500/20">
                <Rocket className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-medium text-foreground">No campaign sprints yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Launch your first Autopilot sprint to generate ready-to-publish content batches with linked SOP execution.
                </p>
              </div>
              <div className="pt-2">
                <LaunchSprintDialog
                  workspaceId={params.ws}
                  clients={clientsList.map((c) => ({
                    id: c.id,
                    name: c.name,
                    handle: c.handle,
                  }))}
                  templates={templateOptions}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sprints.map((sprint) => (
                <Link
                  key={sprint.id}
                  href={`/w/${params.ws}/sprint/${sprint.id}`}
                  className="group p-5 rounded-2xl bg-card hover:bg-muted/40 border border-border hover:border-teal-500/50 transition-all shadow-md space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                        {sprint.clientName ?? "All Clients"}
                      </span>
                      <span className="text-xs font-mono uppercase text-muted-foreground">
                        {sprint.status}
                      </span>
                    </div>
                    <h3 className="text-lg font-medium text-foreground group-hover:text-teal-300 transition-colors">
                      {sprint.name}
                    </h3>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border text-xs font-mono text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>Started: {new Date(sprint.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className="text-teal-400 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                      <span>Open Deck</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
