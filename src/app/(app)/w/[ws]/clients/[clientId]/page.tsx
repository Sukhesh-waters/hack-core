import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientById, listContentForClient } from "@/db/queries/clients";
import { ticketsQuery } from "@/db/queries/tickets";
import { campaignsForClient } from "@/db/queries/campaigns";
import { listClientGoals } from "@/db/queries/client-goals";
import { listDecisionsForClient } from "@/db/queries/decisions";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clientColor, PRODUCTION_STAGE_COLORS } from "@/lib/colors";
import { PRODUCTION_STAGE_LABELS } from "@/lib/production";
import {
  CLIENT_GOAL_STATUS_CHIP,
  CLIENT_GOAL_STATUS_LABELS,
} from "@/lib/client-goals";
import { DECISION_OUTCOME_CHIP, DECISION_OUTCOME_LABELS } from "@/lib/decisions";
import { PRIORITY_COLORS, type TicketPriority } from "../../tickets/ticket-card";
import { GoalForm } from "./goal-form";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Client" };
export const dynamic = "force-dynamic";

const CLIENT_STATUS_STYLE: Record<string, string> = {
  active: "border-brand-teal/40 text-brand-teal",
  paused: "border-brand-amber/40 text-brand-amber",
  archived: "border-border text-muted-foreground/70",
};

const CAMPAIGN_STATUS_STYLE: Record<string, string> = {
  active: "border-brand-teal/40 text-brand-teal",
  paused: "border-border text-muted-foreground/70",
  pending_approval: "border-brand-amber/40 text-brand-amber",
  rejected: "border-destructive/40 text-destructive",
  draft: "border-border text-muted-foreground/70",
};

export default async function ClientDetailPage(
  props: {
    params: Promise<{ ws: string; clientId: string }>;
  }
) {
  const params = await props.params;
  const client = await getClientById(params.ws, params.clientId);
  if (!client) notFound();

  const [tickets, contentItems, campaigns, goals, decisions] = await Promise.all([
    ticketsQuery(params.ws, { clientId: params.clientId }),
    listContentForClient(params.ws, params.clientId),
    campaignsForClient(params.ws, params.clientId),
    listClientGoals(params.ws, params.clientId),
    listDecisionsForClient(params.ws, params.clientId),
  ]);

  return (
    <PageShell width="prose">
      <Link
        href={`/w/${params.ws}/clients`}
        className="text-xs text-muted-foreground/70 hover:text-foreground"
      >
        ← All clients
      </Link>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              clientColor(client.id).dot,
            )}
            aria-hidden
          />
          <div>
            <h1 className="font-display text-3xl">{client.name}</h1>
            {client.handle ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground/70">
                {client.handle}
              </p>
            ) : null}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            CLIENT_STATUS_STYLE[client.status] ?? "border-border text-muted-foreground/70",
          )}
        >
          {client.status}
        </Badge>
      </div>

      {/* Goals */}
      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Goals</p>
          <span className="font-mono text-xs text-muted-foreground/50">
            {goals.length} goal{goals.length === 1 ? "" : "s"}
          </span>
        </div>
        {goals.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No goals yet. A goal gives ideation something to aim at and
            decisions something to attach to.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {goals.map((goal) => (
              <li
                key={goal.id}
                className="rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-foreground">
                    {goal.title}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[11px]",
                      CLIENT_GOAL_STATUS_CHIP[goal.status],
                    )}
                  >
                    {CLIENT_GOAL_STATUS_LABELS[goal.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Metric: {goal.metric} ·{" "}
                  {new Date(goal.targetWindowStart).toLocaleDateString()} –{" "}
                  {new Date(goal.targetWindowEnd).toLocaleDateString()}
                </p>
                {goal.hypothesis ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    {goal.hypothesis}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <GoalForm workspaceId={params.ws} clientId={params.clientId} />
        </div>
      </GlassCard>

      {/* Decisions */}
      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Decisions</p>
          <Link
            href={`/w/${params.ws}/decisions`}
            className="text-xs text-brand-teal hover:underline"
          >
            Record a decision →
          </Link>
        </div>
        {decisions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No decisions recorded for this client yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {decisions.map((decision) => (
              <li
                key={decision.id}
                className="rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-foreground">
                    {decision.title}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[11px]",
                      DECISION_OUTCOME_CHIP[decision.outcome],
                    )}
                  >
                    {DECISION_OUTCOME_LABELS[decision.outcome]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Review {new Date(decision.reviewAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Tickets */}
      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Tickets</p>
          <span className="font-mono text-xs text-muted-foreground/50">
            {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
          </span>
        </div>
        {tickets.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No tickets for this client yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <Link
                  href={`/w/${params.ws}/tickets/${ticket.id}`}
                  className="truncate text-sm text-foreground hover:text-brand-teal hover:underline"
                >
                  {ticket.title}
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px]",
                      PRIORITY_COLORS[ticket.priority as TicketPriority],
                    )}
                  >
                    {ticket.priority}
                  </span>
                  <Badge
                    variant="outline"
                    className="border-border text-[11px] text-muted-foreground/70"
                  >
                    {ticket.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Content / Production */}
      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Content / Production</p>
          <span className="font-mono text-xs text-muted-foreground/50">
            {contentItems.length} item{contentItems.length === 1 ? "" : "s"}
          </span>
        </div>
        {contentItems.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No content for this client yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {contentItems.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <Link
                  href={`/w/${params.ws}/studio/${item.id}`}
                  className="truncate text-sm text-foreground hover:text-brand-teal hover:underline"
                >
                  {item.title}
                </Link>
                {item.productionStage ? (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px]",
                      PRODUCTION_STAGE_COLORS[item.productionStage].chip,
                    )}
                  >
                    {PRODUCTION_STAGE_LABELS[item.productionStage]}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground/50">
                    Not in production
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Campaigns */}
      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Campaigns</p>
          <span className="font-mono text-xs text-muted-foreground/50">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
          </span>
        </div>
        {campaigns.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No campaigns for this client yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {campaigns.map((campaign) => (
              <li
                key={campaign.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <Link
                  href={`/w/${params.ws}/ads`}
                  className="truncate text-sm text-foreground hover:text-brand-teal hover:underline"
                >
                  {campaign.name}
                </Link>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 text-[11px]",
                    CAMPAIGN_STATUS_STYLE[campaign.status] ??
                      "border-border text-muted-foreground/70",
                  )}
                >
                  {campaign.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </PageShell>
  );
}
