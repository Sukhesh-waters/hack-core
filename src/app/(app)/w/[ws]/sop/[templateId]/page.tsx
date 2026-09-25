import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { listWorkspaceMembers, userCan } from "@/db/queries/memberships";
import { loadSopTemplate } from "@/db/queries/sop";
import { getTemplateMetrics } from "@/db/queries/sop-history";
import { TemplateBuilder } from "./template-builder";
import { TemplateMetricsView } from "./template-metrics-view";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const metadata = { title: "SOP template" };
export const dynamic = "force-dynamic";

export default async function SopTemplatePage(
  props: {
    params: Promise<{ ws: string; templateId: string }>;
    searchParams?: Promise<{ tab?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const user = await requireUser();
  const [loaded, canEdit, members, metrics] = await Promise.all([
    loadSopTemplate(params.ws, params.templateId),
    userCan(params.ws, user.id, "sop.template.edit"),
    listWorkspaceMembers(params.ws),
    getTemplateMetrics(params.ws, params.templateId),
  ]);

  // A template id that names nothing IN THIS WORKSPACE 404s rather than
  // erroring — the query is workspace-scoped, so a foreign id lands here too.
  if (!loaded) notFound();

  const tab = searchParams?.tab === "history" ? "history" : "builder";

  return (
    <PageShell width="app">
      <div>
        <Link
          href={`/w/${params.ws}/sop`}
          className="text-sm text-muted-foreground/70 hover:text-muted-foreground"
        >
          ← All templates
        </Link>

        <p className="label-mono mt-4 text-brand-teal">SOP template</p>
        <h1 className="mt-2 font-display text-4xl">{loaded.template.name}</h1>
        {loaded.template.description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {loaded.template.description}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground/70">
          Every step is dated relative to{" "}
          <span className="text-muted-foreground">{loaded.template.anchorLabel}</span>.
        </p>

        {/* Tab Navigation */}
        <div className="mt-6 flex items-center gap-2 border-b border-border/40 pb-3">
          <Link
            href={`/w/${params.ws}/sop/${params.templateId}?tab=builder`}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition",
              tab === "builder"
                ? "bg-accent text-foreground shadow-xs"
                : "text-muted-foreground/70 hover:text-foreground",
            )}
          >
            <span>Process Editor</span>
            <Badge
              variant="outline"
              className="border-border text-muted-foreground text-xs py-0 px-1.5"
            >
              {loaded.steps.length}
            </Badge>
          </Link>
          <Link
            href={`/w/${params.ws}/sop/${params.templateId}?tab=history`}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition",
              tab === "history"
                ? "bg-accent text-foreground shadow-xs"
                : "text-muted-foreground/70 hover:text-foreground",
            )}
          >
            <span>Run History & Metrics</span>
            <Badge
              variant="outline"
              className={cn(
                "text-xs py-0 px-1.5",
                metrics.totalRuns > 0
                  ? "border-brand-teal/40 text-brand-teal"
                  : "border-border text-muted-foreground",
              )}
            >
              {metrics.totalRuns}
            </Badge>
          </Link>
        </div>

        {tab === "history" ? (
          <TemplateMetricsView
            workspaceId={params.ws}
            template={loaded.template}
            metrics={metrics}
          />
        ) : (
          <TemplateBuilder
            workspaceId={params.ws}
            template={loaded.template}
            steps={loaded.steps}
            canEdit={canEdit}
            members={members.map((m) => ({
              userId: m.userId,
              label: m.name ?? m.email ?? "Member",
            }))}
            showHeader={false}
          />
        )}
      </div>
    </PageShell>
  );
}
