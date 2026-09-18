import Link from "next/link";
import { PlatinaPage } from "@/components/platina/page";
import {
  listAlertDeliveries,
  listAuditRuns,
  listCampaigns,
  listFindings,
  listGateEvents,
  listReceipts,
  listScanSpecs,
} from "@/db/queries/platina";
import { buildInbox } from "@/lib/platina/inbox";
import { freshnessState } from "@/lib/platina/run-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina cockpit" };

const FRESHNESS_LABEL = {
  fresh: "Fresh",
  stale: "Stale",
  unknown: "No data yet",
} as const;

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  running: "running",
  validating: "validating",
  completed: "completed",
  degraded: "degraded",
  failed: "failed",
};

/**
 * The executive command center. The priority inbox sits above the fold;
 * every number and row traces to a real workspace-scoped query. No live
 * badge claim — the transport pill in the header reports the real state.
 */
export default async function PlatinaCockpit({
  params,
}: {
  params: { ws: string };
}) {
  const [specs, receipts, campaigns, gates, runs, findings, deliveries] =
    await Promise.all([
      listScanSpecs(params.ws),
      listReceipts(params.ws),
      listCampaigns(params.ws),
      listGateEvents(params.ws),
      listAuditRuns(params.ws, 5),
      listFindings(params.ws),
      listAlertDeliveries(params.ws),
    ]);

  const base = `/p/${params.ws}`;
  const renderedAt = new Date();

  const inbox = buildInbox(
    {
      findings: findings
        .filter((f) => f.status === "needs_decision")
        .map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          createdAt: f.createdAt,
        })),
      receipts: receipts
        .filter((r) => r.outcome === "pending")
        .map((r) => ({ id: r.id, title: r.title, reviewAt: r.reviewAt })),
      draftSpecs: specs
        .filter((s) => s.status === "draft")
        .map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt })),
      draftCampaigns: campaigns
        .filter((c) => c.status === "draft")
        .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt })),
    },
    base,
    renderedAt,
  );

  const health = [
    { label: "Audit sources", value: specs.length, href: `${base}/audits` },
    { label: "Findings", value: findings.length, href: `${base}/findings` },
    { label: "Solutions", value: campaigns.length, href: `${base}/solutions` },
    { label: "Decision receipts", value: receipts.length, href: `${base}/outcomes` },
    { label: "Approvals recorded", value: gates.length, href: `${base}/admin` },
  ];

  // Source health from real probe/run timestamps — no invented telemetry.
  const sourceHealth = specs.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    freshness: freshnessState(s.lastSuccessAt, renderedAt),
    lastRun: s.lastRunAt,
    failed: s.lastFailureAt,
  }));

  // One merged activity timeline: approvals, runs, alert deliveries.
  const activity = [
    ...gates.map((g) => ({
      at: g.createdAt,
      text: `${g.gate} ${g.decision}`,
      href: `${base}/outcomes`,
      kind: "approval" as const,
    })),
    ...runs.map((r) => ({
      at: r.queuedAt,
      text: `audit ${RUN_STATUS_LABEL[r.status] ?? r.status}`,
      href: `${base}/audits`,
      kind: "run" as const,
    })),
    ...deliveries.map((d) => ({
      at: d.createdAt,
      text: `alert ${d.status}`,
      href: `${base}/admin`,
      kind: "alert" as const,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10);

  const portfolio = [
    {
      title: "Competitive intelligence",
      body: "Track competitor and market changes from approved public sources.",
      href: `${base}/audits`,
    },
    {
      title: "Event readiness",
      body: "Conference and event campaign preparation, anchored to the date.",
      href: `${base}/solutions`,
    },
    {
      title: "Brand drift",
      body: "Compare copy against the confirmed brand standard.",
      href: `${base}/admin/brand`,
    },
    {
      title: "Claims and compliance",
      body: "Screen marketing copy against the claims rules.",
      href: `${base}/admin/claims`,
    },
    {
      title: "Campaign performance",
      body: "Grade recorded outcomes against the hypothesis they tested.",
      href: `${base}/outcomes`,
    },
  ];

  return (
    <PlatinaPage
      eyebrow="Platina · Cockpit"
      title="What changed, what matters, what needs you"
      description={`Data as of ${renderedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Platina never writes to Waters systems.`}
    >
      <section aria-label="Priority inbox" className="mb-8">
        <h2 className="font-display text-lg font-medium">Priority inbox</h2>
        {inbox.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
            Nothing needs a decision. New findings, due reviews, and pending
            approvals land here ordered by severity.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {inbox.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {item.kind.replace("_", " ")}
                    {item.overdue ? " · overdue" : ""}
                  </span>
                  <p className="text-sm font-medium">{item.title}</p>
                </div>
                <Link
                  href={item.href}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                >
                  {item.action}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Workspace health">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {health.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-1 font-display text-2xl">{stat.value}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-label="Source health">
          <h2 className="font-display text-lg font-medium">Source health</h2>
          {sourceHealth.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
              No sources yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {sourceHealth.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span
                      className={
                        s.freshness === "stale"
                          ? "rounded bg-destructive/10 px-2 py-0.5 text-destructive"
                          : "rounded bg-secondary px-2 py-0.5 text-secondary-foreground"
                      }
                    >
                      {FRESHNESS_LABEL[s.freshness]}
                    </span>
                    <span>{s.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Live activity">
          <h2 className="font-display text-lg font-medium">Live activity</h2>
          {activity.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
              No activity yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {activity.map((a, i) => (
                <li key={i}>
                  <Link
                    href={a.href}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent/50"
                  >
                    <span>{a.text}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {a.at.toLocaleString("en-GB", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Use-case portfolio" className="mt-8">
        <h2 className="font-display text-lg font-medium">Use-case portfolio</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {portfolio.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <p className="font-medium">{card.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>
            </Link>
          ))}
        </div>
      </section>

      {specs.length === 0 && (
        <section className="mt-8 rounded-lg border border-border bg-secondary p-5">
          <h2 className="font-display text-lg font-medium">Start here</h2>
          <p className="mt-1 text-sm text-secondary-foreground">
            Platina observes approved public sources on a cadence you choose.
            Define the first audit source to begin detecting competitor and
            market changes.
          </p>
          <Link
            href={`${base}/audits`}
            className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Define an audit source
          </Link>
        </section>
      )}
    </PlatinaPage>
  );
}
