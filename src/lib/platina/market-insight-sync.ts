/**
 * Loads the stored measurements and refreshes their Brain insights (C5).
 * Called at the end of the interest job (per client) and the event job (per
 * workspace), and by scripts/insights-sync.ts. Server-only: reads the DB.
 */
import {
  getBrand,
  insertBrainChunk,
  listActiveInsightChunks,
  listBrands,
  listCompetitorsOf,
  listEventParticipants,
  listEvents,
  listInterestSignals,
  supersedeBrainChunks,
} from "@/db/queries/platina";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { embedText } from "./embed";
import { BASELINE_DAYS, RECENT_DAYS, topicMomentum } from "./interest";
import { writeClientInsights, writeEventInsights, type InsightWriterDeps, type InsightWriteResult } from "./market-insight-writer";

const deps: InsightWriterDeps = {
  embed: (text) => embedText(text),
  listActive: (ws, prefix) => listActiveInsightChunks(ws, prefix),
  insert: (row) => insertBrainChunk(row),
  supersede: (ws, ids) => supersedeBrainChunks(ws, ids),
};

export async function syncClientInsights(
  workspaceId: string,
  clientId: string,
  now: Date = new Date(),
): Promise<InsightWriteResult | { status: "not_a_client" }> {
  const client = await getBrand(workspaceId, clientId);
  if (!client || client.kind !== "own_brand") return { status: "not_a_client" };
  const competitors = await listCompetitorsOf(workspaceId, client.id);
  const ids = [client.id, ...competitors.map((c) => c.id)];
  const since = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000);
  const signals = await listInterestSignals(workspaceId, ids, since);
  return runWithAiCost({ workspaceId, purpose: "market-insights" }, () =>
    writeClientInsights(deps, {
      workspaceId,
      client: { id: client.id, name: client.name },
      names: new Map([[client.id, client.name], ...competitors.map((c) => [c.id, c.name] as [string, string])]),
      momentum: topicMomentum(signals, now),
      signals: signals.map((s) => ({
        topic: s.topic,
        region: s.region,
        signalKind: s.signalKind,
        value: s.value,
        observedAt: s.observedAt,
        documentId: s.documentId,
        brandId: s.brandId,
      })),
    }),
  );
}

export async function syncEventInsights(workspaceId: string, now: Date = new Date()): Promise<InsightWriteResult> {
  const [brands, events] = await Promise.all([listBrands(workspaceId), listEvents(workspaceId)]);
  const participants = await listEventParticipants(workspaceId, events.map((e) => e.id));
  return runWithAiCost({ workspaceId, purpose: "market-insights" }, () =>
    writeEventInsights(deps, {
      workspaceId,
      names: new Map(brands.map((b) => [b.id, b.name])),
      now,
      events: events.map((e) => ({
        eventKey: e.eventKey,
        name: e.name,
        format: e.format,
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        location: e.location,
        country: e.country,
        documentId: e.documentId,
        detail: e.detail,
        participants: participants
          .filter((p) => p.eventId === e.id)
          .map((p) => ({ brandId: p.brandId, evidence: p.evidence, documentId: p.documentId })),
      })),
    }),
  );
}
