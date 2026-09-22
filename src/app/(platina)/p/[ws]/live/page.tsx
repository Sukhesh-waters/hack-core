import { FlowScene, type BrainPoint } from "@/components/platina/flow-scene";
import { PlatinaPage } from "@/components/platina/page";
import { getFlowCounts, listFlowBrainSample } from "@/db/queries/platina";
import { buildFlowGraph, STAGES, type FlowCounts } from "@/lib/platina/flow-graph";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live flow" };

const n = (row: Record<string, number>, key: string) => Number(row[key] ?? 0);

function toCounts(row: Record<string, number>): FlowCounts {
  return {
    docs: { web: n(row, "docsWeb"), linkedin: n(row, "docsLinkedin"), ads: n(row, "docsAds"), events: n(row, "docsEvents") },
    docs24h: {
      web: n(row, "docsWeb24h"),
      linkedin: n(row, "docsLinkedin24h"),
      ads: n(row, "docsAds24h"),
      events: n(row, "docsEvents24h"),
    },
    debates: n(row, "debates"),
    debates24h: n(row, "debates24h"),
    interestSignals: n(row, "interestSignals"),
    interestSignals24h: n(row, "interestSignals24h"),
    events: n(row, "events"),
    eventsUpcoming: n(row, "eventsUpcoming"),
    events24h: n(row, "events24h"),
    brain: { claims: n(row, "brainClaims"), measured: n(row, "brainMeasured"), events: n(row, "brainEvents") },
    brain24h: n(row, "brain24h"),
    findings: n(row, "findings"),
    findingsNew: n(row, "findingsNew"),
    plans: n(row, "plans"),
    plans24h: n(row, "plans24h"),
    outcomes: n(row, "outcomes"),
    runsActive: n(row, "runsActive"),
    learning: {
      ownSite: n(row, "ownSite"),
      ownSite24h: n(row, "ownSite24h"),
      lessons: n(row, "lessons"),
      lessons24h: n(row, "lessons24h"),
      creatives: n(row, "creatives"),
      metrics: n(row, "creativeMetrics"),
      metrics24h: n(row, "creativeMetrics24h"),
      reviewsConfirmed: n(row, "reviewsConfirmed"),
      reviewsConfirmed24h: n(row, "reviewsConfirmed24h"),
      backtracks: n(row, "backtracks"),
      backtracks24h: n(row, "backtracks24h"),
    },
  };
}

const kindOf = (key: string | null): BrainPoint["kind"] =>
  !key ? "claim" : key.startsWith("event:") ? "event" : "measured";

/**
 * The whole intelligence flow, live, in 3D. One database round trip for every
 * count plus the newest Brain vectors; the header's live signal refreshes it
 * and the scene fires a burst along the edges that just carried new data.
 */
export default async function LiveFlowPage({ params }: { params: { ws: string } }) {
  const now = new Date();
  const [row, sample] = await Promise.all([getFlowCounts(params.ws, now), listFlowBrainSample(params.ws)]);
  const counts = toCounts(row);
  const { nodes, edges } = buildFlowGraph(counts);
  const dayAgo = now.getTime() - 86_400_000;
  const brain: BrainPoint[] = sample.map((c) => ({
    id: c.id,
    kind: kindOf(c.insightKey),
    recent: new Date(c.createdAt).getTime() >= dayAgo,
  }));
  const label = `Live flow: ${nodes.map((x) => `${x.label} ${x.value}`).join(", ")}.`;

  return (
    <PlatinaPage
      eyebrow="Live"
      title="How your intelligence flows, right now"
      description="Everything collected, analysed and learned for this workspace, as it happens. Dots travel each path in proportion to the last 24 hours; a bright burst means new data just arrived. The sphere around the Brain is one point per stored insight vector."
    >
      <FlowScene nodes={nodes} edges={edges} brain={brain} label={label} />

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#7c3aed]" /> debate claim
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#0f9d8a]" /> measured interest
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#d97706]" /> event
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#f59e0b]" /> new arrival
        </span>
        <span>Faded points are older than 24 h.</span>
      </div>

      <section aria-label="The same numbers as a list" className="mt-8 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((stage) => (
          <div key={stage.id} className="rounded-lg border border-border bg-card p-3">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{stage.label}</h2>
            <ul className="mt-2 space-y-2">
              {nodes
                .filter((x) => x.stage === stage.id)
                .map((x) => (
                  <li key={x.id}>
                    <span className="block text-sm">
                      {x.label} <span className="font-mono text-muted-foreground">{x.value.toLocaleString()}</span>
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{x.caption}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-label="Newest insights" className="mt-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Newest in the Brain
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {sample.slice(0, 8).map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <span className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {kindOf(c.insightKey)}
              </span>
              <span className="min-w-0 flex-1">{c.text}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {new Date(c.createdAt).toISOString().slice(5, 16).replace("T", " ")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </PlatinaPage>
  );
}
