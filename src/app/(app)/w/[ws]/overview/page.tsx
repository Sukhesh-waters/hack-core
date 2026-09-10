import Link from "next/link";
import { getOverviewData } from "@/lib/data/overview";
import { GlassCard } from "@/components/glass-card";
import { PageShell } from "@/components/page-shell";

import { LiveDigest, type DigestEvent } from "./live-digest";

export const metadata = { title: "Overview" };
// V3 (Marketing OS composition): a plain force-dynamic server render is the
// chosen real-time strategy for this slice — every request re-runs
// getOverviewData against live tables, no client polling/websocket infra
// added. This is the same mechanism the page already used pre-V3; extending
// it satisfies the plan's "signal + refetch" ladder at the cheapest tier.
export const dynamic = "force-dynamic";

function usd(value: number) {
  return `$${value.toFixed(value < 0.1 ? 4 : 2)}`;
}

const DRIFT_NARRATIVE_COLOR: Record<string, string> = {
  steady: "text-brand-teal",
  drifting: "text-brand-amber",
  "needs attention": "text-destructive",
};

export default async function OverviewPage({
  params,
}: {
  params: { ws: string };
}) {
  const data = await getOverviewData(params.ws);
  const base = `/w/${params.ws}`;

  const now = new Date();
  const sampleEvents: DigestEvent[] = [
    {
      id: "digest-1",
      pillar: "operate",
      iconKind: "sop",
      title: "SOP & Production",
      subtitle: `${data.productionBoard.length} content items active across production stages`,
      timestamp: new Date(now.getTime() - 15 * 60 * 1000),
    },
    {
      id: "digest-2",
      pillar: "brand",
      iconKind: "content",
      title: "Editorial Pipeline",
      subtitle: `${data.upcoming.length} upcoming scheduled posts across channels`,
      timestamp: new Date(now.getTime() - 45 * 60 * 1000),
    },
    {
      id: "digest-3",
      pillar: "growth",
      iconKind: "campaign",
      title: "AI Budget & Usage",
      subtitle: `Today's AI spend tracked at ${usd(data.spend.todayUsd)} across models`,
      timestamp: new Date(now.getTime() - 90 * 60 * 1000),
    },
  ];

  return (
    <PageShell width="app">
      <h1 className="font-display text-3xl">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground/70">
        Pipeline health at a glance — the workspace&apos;s morning screen.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.stats.map((st) => (
          <GlassCard key={st.label} className="p-5">
            <p className="label-mono text-muted-foreground/70">{st.label}</p>
            <p className="mt-2 font-display text-3xl">{st.value}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{st.sub}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="mt-6 p-5">
        <p className="label-mono text-muted-foreground/70">Quick actions</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`${base}/ideation`}
            className="rounded-xl bg-accent px-4 py-2 text-sm transition hover:bg-accent"
          >
            ✦ Generate ideas
          </Link>
          <Link
            href={`${base}/plan`}
            className="rounded-xl bg-accent px-4 py-2 text-sm transition hover:bg-accent"
          >
            Calendar plan
          </Link>
          <Link
            href={`${base}/production`}
            className="rounded-xl bg-accent px-4 py-2 text-sm transition hover:bg-accent"
          >
            Production board
          </Link>
          <Link
            href={`${base}/approvals`}
            className="rounded-xl bg-accent px-4 py-2 text-sm transition hover:bg-accent"
          >
            Review approvals
          </Link>
        </div>
      </GlassCard>

      <div className="mt-6">
        <LiveDigest events={sampleEvents} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <p className="label-mono text-brand-teal">Production board</p>
          <div className="mt-3 space-y-2">
            {data.productionBoard.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-xl bg-muted px-4 py-3"
              >
                <p className="text-sm">{row.title}</p>
                <p className="label-mono text-[10px] text-muted-foreground/70">
                  {row.stage}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <p className="label-mono text-brand-purple">Upcoming on calendar</p>
          <div className="mt-3 space-y-2">
            {data.upcoming.map((slot) => (
              <div key={slot.id} className="rounded-xl bg-muted px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm">{slot.title}</p>
                  <p className="label-mono text-[10px] text-muted-foreground/70">
                    {slot.status}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  {slot.platform} · Day {slot.day}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      <div className="mt-10">
        <p className="label-mono text-muted-foreground/70">Marketing OS · operational glance</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          A read-only window over Cockpit, Brand Drift, Tickets, and
          Automations — click through to act.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href={`${base}/cockpit`} className="block">
            <GlassCard className="h-full p-5 transition hover:bg-muted/50">
              <p className="label-mono text-brand-amber">AI spend today</p>
              <p className="mt-2 font-display text-2xl">
                {usd(data.spend.todayUsd)}
                <span className="ml-1 text-sm text-muted-foreground/70">
                  / {usd(data.spend.capUsd)}
                </span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-accent">
                <div
                  className={
                    data.spend.overCap
                      ? "h-full bg-brand-amber"
                      : "h-full bg-brand-teal"
                  }
                  style={{ width: `${data.spend.percentUsed}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground/70">
                {data.spend.percentUsed}% of daily cap
                {data.spend.overCap ? " · cap reached" : ""}
              </p>
            </GlassCard>
          </Link>

          <Link href={`${base}/drift`} className="block">
            <GlassCard className="h-full p-5 transition hover:bg-muted/50">
              <p className="label-mono text-brand-teal">Compliance drift</p>
              {data.drift.worstNarrative ? (
                <>
                  <p
                    className={`mt-2 font-display text-2xl capitalize ${DRIFT_NARRATIVE_COLOR[data.drift.worstNarrative] ?? "text-foreground"}`}
                  >
                    {data.drift.worstNarrative}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    worst: {data.drift.worstClientName}
                  </p>
                </>
              ) : (
                <p className="mt-2 font-display text-2xl text-muted-foreground/70">
                  Insufficient data
                </p>
              )}
              <p className="mt-2 font-mono text-xs text-muted-foreground/70">
                {data.drift.scoredCount} client
                {data.drift.scoredCount === 1 ? "" : "s"} scored
                {data.drift.insufficientCount > 0
                  ? ` · ${data.drift.insufficientCount} below baseline`
                  : ""}
              </p>
            </GlassCard>
          </Link>

          <Link href={`${base}/tickets`} className="block">
            <GlassCard className="h-full p-5 transition hover:bg-muted/50">
              <p className="label-mono text-muted-foreground/70">Open tickets</p>
              <p className="mt-2 font-display text-2xl">
                {data.tickets.openCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                {data.tickets.overdueCount} overdue
              </p>
            </GlassCard>
          </Link>

          <Link href={`${base}/automations`} className="block">
            <GlassCard className="h-full p-5 transition hover:bg-muted/50">
              <p className="label-mono text-brand-purple">
                Automation failures
              </p>
              <p className="mt-2 font-display text-2xl">
                {data.automations.failureCount}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground/70">
                {data.automations.mostRecent
                  ? `${data.automations.mostRecent.ruleName}: ${(
                      data.automations.mostRecent.error ?? "failed"
                    ).slice(0, 40)}`
                  : "none recent"}
              </p>
            </GlassCard>
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
