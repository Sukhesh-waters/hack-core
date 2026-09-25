/**
 * Loads the Ads view for a workspace's client (C8.3): the page and the Brain
 * sync read the same rows through this, so what the page shows and what the
 * Brain knows never disagree. Server-only: reads the DB.
 */
import { adDocumentsQuery, adTopicsQuery, listBrands, listCompetitorsOf } from "@/db/queries/platina";
import { buildAdsView, type AdsView } from "./ads-view";

/** Ads older than this are not shown or measured. */
export const ADS_LOOKBACK_DAYS = 180;

export type LoadedAds = {
  client: { id: string; name: string };
  competitors: { id: string; name: string }[];
  view: AdsView;
};

export async function loadAdsView(workspaceId: string, now: Date = new Date(), clientId?: string): Promise<LoadedAds | null> {
  const brands = await listBrands(workspaceId);
  const client = brands.find((b) => b.kind === "own_brand" && b.status === "active" && (!clientId || b.id === clientId));
  if (!client) return null;
  const competitors = (await listCompetitorsOf(workspaceId, client.id)).map((c) => ({ id: c.id, name: c.name }));
  const ids = [client.id, ...competitors.map((c) => c.id)];
  const since = new Date(now.getTime() - ADS_LOOKBACK_DAYS * 86_400_000);
  const [docs, topics] = await Promise.all([adDocumentsQuery(workspaceId, ids, since), adTopicsQuery(workspaceId, ids)]);
  const topicsByAd = new Map<string, string[]>();
  for (const t of topics) topicsByAd.set(t.sourceUrl, [...(topicsByAd.get(t.sourceUrl) ?? []), t.topic]);
  const view = buildAdsView({
    client: { id: client.id, name: client.name },
    competitors,
    docs: docs.map((d) => ({ ...d, fetchedAt: new Date(d.fetchedAt) })),
    topicsByAd,
    now,
  });
  return { client: { id: client.id, name: client.name }, competitors, view };
}
