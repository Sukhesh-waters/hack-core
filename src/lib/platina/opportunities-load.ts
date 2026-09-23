/**
 * Everything the Opportunities page shows, in one place (C8.4), so the page
 * and the AI campaign brief route build exactly the same campaigns from the
 * same stored facts. Two database rounds; no model call.
 */
import {
  listBrands,
  listClientScopeSignals,
  listCompetitorsOf,
  listEvents,
  listPlansWithVerdict,
  listWorkspaceEventParticipants,
} from "@/db/queries/platina";
import { BASELINE_DAYS, clientTopics, RECENT_DAYS, topicMomentum } from "./interest";
import { learningSeed } from "./learning";
import { learningState } from "./learning-service";
import { buildCampaigns, buildInsights } from "./opportunities";
import { learnCampaigns } from "./opportunity-learning";

export async function loadOpportunities(workspaceId: string, clientId?: string | null, now = new Date()) {
  const [brands, events, participants, plans] = await Promise.all([
    listBrands(workspaceId),
    listEvents(workspaceId),
    listWorkspaceEventParticipants(workspaceId),
    listPlansWithVerdict(workspaceId),
  ]);
  const clients = brands.filter((b) => b.kind === "own_brand");
  const client = clients.find((c) => c.id === clientId) ?? clients[0];
  if (!client) return { clients, client: null } as const;

  const since = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000);
  const [competitors, signals, learning] = await Promise.all([
    listCompetitorsOf(workspaceId, client.id),
    listClientScopeSignals(workspaceId, client.id, since),
    learningState(workspaceId, client.id, now),
  ]);

  const input = {
    client: {
      id: client.id,
      name: client.name,
      region: client.region ?? null,
      topics: clientTopics(client.profile ?? null, client.name),
    },
    competitors: competitors.map((c) => ({ id: c.id, name: c.name })),
    momentum: topicMomentum(signals, now),
    proofOwner: new Map(signals.map((s) => [s.sourceUrl, s.brandId])),
    events: events.map((e) => ({
      ...e,
      participants: participants.filter((p) => p.eventId === e.id),
    })),
    now,
  };
  const insights = buildInsights(input);
  // Rule order first (C5), then the client's own confirmed results (C6).
  const ruled = buildCampaigns(input);
  const learnOptions = {
    stats: learning.stats,
    minN: learning.config.minN,
    exploreShare: learning.config.exploreShare,
  };
  const campaigns = {
    events: learnCampaigns(ruled.events, { ...learnOptions, seed: learningSeed(workspaceId, now, `${client.id}:events`) }),
    topics: learnCampaigns(ruled.topics, { ...learnOptions, seed: learningSeed(workspaceId, now, `${client.id}:topics`) }),
  };
  return {
    clients,
    client,
    competitors,
    signals,
    learning,
    insights,
    campaigns,
    plans: plans.filter((p) => p.brandId === client.id),
  } as const;
}
