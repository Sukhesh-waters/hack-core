/**
 * Today's idea triggers for a workspace's client (C8.5), from the same
 * computed opportunities and ad detections the pages show. Server-only: DB.
 */
import { loadAdsView } from "./ads-load";
import { findTriggers, type IdeaTrigger } from "./idea-engine";
import { loadOpportunities } from "./opportunities-load";

export async function loadTriggers(workspaceId: string, now: Date = new Date()) {
  const [opps, ads] = await Promise.all([loadOpportunities(workspaceId, null, now), loadAdsView(workspaceId, now)]);
  if (!opps.client) return { client: null, triggers: [] as IdeaTrigger[] } as const;
  const triggers = findTriggers({
    events: opps.campaigns.events,
    topics: opps.campaigns.topics,
    adDetections: ads?.view.detections ?? [],
    regionCodes: ads?.view.region.codes ?? [],
  });
  return { client: opps.client, triggers } as const;
}
