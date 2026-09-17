import Link from "next/link";
import { PlatinaPage } from "@/components/platina/page";
import {
  listAuditRuns,
  listBrainChunks,
  listCampaigns,
  listGateEvents,
  listReceipts,
  listScanSpecs,
} from "@/db/queries/platina";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina cockpit" };

/**
 * The executive command center. Every number is a real count from this
 * workspace's tables; every action links to a surface that performs the work.
 * No live badge — the Realtime spine lands in Slice 2.
 */
export default async function PlatinaCockpit({
  params,
}: {
  params: { ws: string };
}) {
  const [specs, hypotheses, receipts, campaigns, gates, runs] =
    await Promise.all([
      listScanSpecs(params.ws),
      listBrainChunks(params.ws),
      listReceipts(params.ws),
      listCampaigns(params.ws),
      listGateEvents(params.ws),
      listAuditRuns(params.ws, 5),
    ]);

  const base = `/p/${params.ws}`;
  const draftsAwaitingScope = specs.filter((s) => s.status === "draft").length;
  const receiptsPending = receipts.filter((r) => r.outcome === "pending");
  const campaignsDraft = campaigns.filter((c) => c.status === "draft").length;
  const lastApproval = gates[0]?.createdAt ?? null;
  const renderedAt = new Date();

  const health = [
    { label: "Audit sources", value: specs.length, href: `${base}/audits` },
    { label: "Derived hypotheses", value: hypotheses.length, href: `${base}/findings` },
    { label: "Solutions", value: campaigns.length, href: `${base}/solutions` },
    { label: "Decision receipts", value: receipts.length, href: `${base}/outcomes` },
    { label: "Approvals recorded", value: gates.length, href: `${base}/outcomes` },
  ];

  const decisions = [
    {
      label: "Audit scopes awaiting approval",
      count: draftsAwaitingScope,
      href: `${base}/audits`,
      action: "Review audit scopes",
    },
    {
      label: "Solutions awaiting final approval",
      count: campaignsDraft,
      href: `${base}/solutions`,
      action: "Review solutions",
    },
    {
      label: "Outcomes awaiting review",
      count: receiptsPending.length,
      href: `${base}/outcomes`,
      action: "Grade outcomes",
    },
  ];

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
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {lastApproval
            ? `Last approval activity ${lastApproval.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
            : "No approval activity yet"}
        </p>
      </section>

      <section aria-label="Decisions needed" className="mt-8">
        <h2 className="font-display text-lg font-medium">Decisions needed</h2>
        <div className="mt-3 space-y-2">
          {decisions.map((d) => (
            <div
              key={d.label}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    d.count > 0
                      ? "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 font-mono text-xs text-primary-foreground"
                      : "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-secondary px-2 font-mono text-xs text-secondary-foreground"
                  }
                >
                  {d.count}
                </span>
                <p className="text-sm">{d.label}</p>
              </div>
              {d.count > 0 ? (
                <Link
                  href={d.href}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                >
                  {d.action}
                </Link>
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">
                  nothing waiting
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

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

      <section aria-label="Recent audit activity" className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-medium">
            Recent audit activity
          </h2>
          <Link
            href={`${base}/audits`}
            className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            all runs →
          </Link>
        </div>
        {runs.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
            No audit runs yet. Runs start from approved sources in Audits.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {run.queuedAt.toLocaleString("en-GB", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <span className="text-muted-foreground">{run.trigger}</span>
                <span
                  className={
                    run.status === "failed" || run.status === "degraded"
                      ? "rounded bg-destructive/10 px-2 py-0.5 font-mono text-[11px] text-destructive"
                      : "rounded bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground"
                  }
                >
                  {run.status}
                </span>
              </li>
            ))}
          </ul>
        )}
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
