import Link from "next/link";
import { BrainMapScene } from "@/components/platina/brain-map-scene";
import { PlatinaPage } from "@/components/platina/page";
import {
  brainMapChunksQuery,
  documentBrandsQuery,
  listBrands,
  listClientScopeSignals,
  listCompetitorsOf,
  listEvents,
  listWorkspaceEventParticipants,
} from "@/db/queries/platina";
import { buildBrainMap } from "@/lib/platina/brain-map";
import { eventTiming } from "@/lib/platina/events";
import { BASELINE_DAYS, isGenericTopic, RECENT_DAYS } from "@/lib/platina/interest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brain map" };

/** Subjects need this many posts across all companies to earn a node. */
const MIN_TOPIC_POSTS = 2;

/**
 * Brain map (C8.6): everything Platina knows for this client as one 3D graph —
 * the client, its competitors, the subjects they post about, the events they
 * go to, the AI insights, and the public sources those insights rest on.
 * Built from stored rows on each visit; no model call.
 */
export default async function BrainMapPage(props: { params: Promise<{ ws: string }> }) {
  const { ws } = await props.params;
  const now = new Date();
  const brands = await listBrands(ws);
  const client = brands.find((b) => b.kind === "own_brand" && b.status === "active");
  if (!client) {
    return (
      <PlatinaPage eyebrow="Watch" title="Brain map">
        <p className="text-sm text-muted-foreground">
          Add a client first.{" "}
          <Link href={`/p/${ws}/start`} className="text-primary underline-offset-4 hover:underline">
            Add a client
          </Link>
        </p>
      </PlatinaPage>
    );
  }
  const since = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000);
  const [competitors, insights, signals, events, participants] = await Promise.all([
    listCompetitorsOf(ws, client.id),
    brainMapChunksQuery(ws),
    listClientScopeSignals(ws, client.id, since),
    listEvents(ws),
    listWorkspaceEventParticipants(ws),
  ]);
  const docIds = [...new Set(insights.flatMap((i) => (i.sourceSignalIds as string[] | null) ?? []))].slice(0, 400);
  const documents = docIds.length ? await documentBrandsQuery(ws, docIds) : [];

  const perBrandTopic = new Map<string, { brandId: string | null; topic: string; posts: number }>();
  const perTopic = new Map<string, number>();
  for (const s of signals) {
    if (s.signalKind !== "interest" || isGenericTopic(s.topic)) continue;
    const key = `${s.brandId}|${s.topic}`;
    const row = perBrandTopic.get(key) ?? { brandId: s.brandId, topic: s.topic, posts: 0 };
    row.posts += 1;
    perBrandTopic.set(key, row);
    perTopic.set(s.topic, (perTopic.get(s.topic) ?? 0) + 1);
  }
  const topics = [...perBrandTopic.values()].filter((t) => (perTopic.get(t.topic) ?? 0) >= MIN_TOPIC_POSTS);
  const upcoming = events.filter((e) => eventTiming(e, now) !== "past" && e.startsOn);
  const upcomingIds = new Set(upcoming.map((e) => e.id));

  const map = buildBrainMap({
    client: { id: client.id, name: client.name },
    competitors: competitors.map((c) => ({ id: c.id, name: c.name })),
    insights: insights.map((i) => ({
      id: i.id,
      content: i.content,
      insightKey: i.insightKey,
      sourceSignalIds: (i.sourceSignalIds as string[] | null) ?? [],
      agreementState: i.agreementState,
    })),
    documents,
    topics,
    events: upcoming.map((e) => ({ id: e.id, eventKey: e.eventKey, name: e.name, startsOn: e.startsOn })),
    participants: participants.filter((p) => upcomingIds.has(p.eventId)),
  });

  return (
    <PlatinaPage
      eyebrow="Watch"
      title="Brain map"
      description={`Everything Platina has learnt for ${client.name}, connected: ${map.counts.competitor} competitors, ${map.counts.topic} subjects, ${map.counts.event} upcoming events, ${map.counts.insight} AI insights and the ${map.counts.source} public sources they rest on. Every link says why it exists.`}
    >
      <BrainMapScene nodes={map.nodes} links={map.links} />
      <p className="mt-3 text-xs text-muted-foreground">
        Public data and the insights drawn from it. {client.name}&apos;s own pages stay on its own page and are not mixed in here.
      </p>
    </PlatinaPage>
  );
}
