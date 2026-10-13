/**
 * The real MeasureDeps for the falsifier metric registry (B0). One reader
 * per FalsifierMetricId, each reusing an existing query — no new query file
 * — and filtering in memory down to the segment keys the query itself
 * doesn't scope by (topic, the signal's `metric`/`signalKind` columns), the
 * same way interest.ts and market-insights.ts already filter those rows.
 *
 * Nothing in B0 calls this yet (no live code path measures a falsifier
 * before B1/B5 exist); it is built now so those slices have a concrete
 * MeasureDeps to import instead of each writing its own.
 */
import { brandsQuery, eventParticipantsQuery, interestSignalsQuery } from "@/db/queries/platina";
import { metricsForCreativesQuery } from "@/db/queries/platina-learning";
import type { MeasureDeps, Observation } from "./falsifier-metrics";

async function interestObservations(
  workspaceId: string,
  brandIds: string[],
  since: Date,
  topic: string,
  metric: string,
  signalKind: string,
): Promise<Observation[]> {
  if (brandIds.length === 0) return [];
  const rows = await interestSignalsQuery(workspaceId, brandIds, since);
  return rows
    .filter((r) => r.topic === topic && r.metric === metric && r.signalKind === signalKind)
    .map((r) => ({ value: r.value, observedAt: new Date(r.observedAt) }));
}

/** engagements / (impressions ?? reach) for one creative-metric snapshot, or null — same rule as review.ts engagementRate(). */
function engagementRateOf(row: { engagements: number | null; impressions: number | null; reach: number | null }): number | null {
  if (row.engagements === null) return null;
  const base = row.impressions ?? row.reach;
  return base === null || base <= 0 ? null : row.engagements / base;
}

function ctrOf(row: { clicks: number | null; impressions: number | null }): number | null {
  if (row.clicks === null || row.impressions === null || row.impressions <= 0) return null;
  return row.clicks / row.impressions;
}

export const measureDeps: MeasureDeps = {
  engagement_index: async (workspaceId, segment, from) => {
    if (!segment.brand || !segment.topic) return [];
    return interestObservations(workspaceId, [segment.brand], from, segment.topic, "engagement_index", "interest");
  },

  // Market-wide (no brand in the segment): reads every tracked brand's
  // engagement_index on the topic, the same rows interest.ts
  // topicMomentum() reads today for signalKind "interest".
  topic_momentum: async (workspaceId, segment, from) => {
    if (!segment.topic) return [];
    const brands = await brandsQuery(workspaceId);
    return interestObservations(
      workspaceId,
      brands.map((b: { id: string }) => b.id),
      from,
      segment.topic,
      "engagement_index",
      "interest",
    );
  },

  ad_days_running: async (workspaceId, segment, from) => {
    if (!segment.brand || !segment.topic) return [];
    return interestObservations(workspaceId, [segment.brand], from, segment.topic, "ad_days_running", "pressure");
  },

  event_participants: async (workspaceId, segment, from) => {
    if (!segment.eventId) return [];
    const rows = await eventParticipantsQuery(workspaceId, [segment.eventId]);
    return rows
      .filter((r) => new Date(r.observedAt).getTime() >= from.getTime())
      .map((r) => ({ value: 1, observedAt: new Date(r.observedAt) }));
  },

  creative_engagement_rate: async (workspaceId, segment, from) => {
    if (!segment.creativeId) return [];
    const rows = await metricsForCreativesQuery(workspaceId, [segment.creativeId]);
    return rows
      .filter((r) => new Date(r.capturedAt).getTime() >= from.getTime())
      .map((r) => ({ rate: engagementRateOf(r), capturedAt: r.capturedAt }))
      .filter((r): r is { rate: number; capturedAt: Date } => r.rate !== null)
      .map((r) => ({ value: r.rate, observedAt: new Date(r.capturedAt) }));
  },

  creative_ctr: async (workspaceId, segment, from) => {
    if (!segment.creativeId) return [];
    const rows = await metricsForCreativesQuery(workspaceId, [segment.creativeId]);
    return rows
      .filter((r) => new Date(r.capturedAt).getTime() >= from.getTime())
      .map((r) => ({ ctr: ctrOf(r), capturedAt: r.capturedAt }))
      .filter((r): r is { ctr: number; capturedAt: Date } => r.ctr !== null)
      .map((r) => ({ value: r.ctr, observedAt: new Date(r.capturedAt) }));
  },

  creative_leads: async (workspaceId, segment, from) => {
    if (!segment.creativeId) return [];
    const rows = await metricsForCreativesQuery(workspaceId, [segment.creativeId]);
    return rows
      .filter((r) => new Date(r.capturedAt).getTime() >= from.getTime() && r.leads !== null)
      .map((r) => ({ value: r.leads as number, observedAt: new Date(r.capturedAt) }));
  },
};

