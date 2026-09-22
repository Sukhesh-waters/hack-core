/**
 * Connected-account metrics into creative snapshots (C6 L3). The matching is
 * pure (`matchConnectedMetrics`); `syncConnectedMetrics` reads through the one
 * allowlisted read-only connector call and writes snapshots.
 *
 * A post matches a logged creative by its platform id or its link. Posts that
 * match nothing are ignored (Platina learns only from creatives someone
 * logged with a hypothesis). A failing connection is reported, and the manual
 * form and spreadsheet import stay available (degradation ladder).
 */
import { listCreatives, upsertMetricSnapshots, type MetricInput } from "@/db/queries/platina-learning";
import {
  listMetricConnections,
  readConnectionPostMetrics,
  type ConnectedPostMetrics,
} from "@/lib/connectors/metrics-read";
import { refKey } from "./metrics-import";

/** Likes + comments + saves + shares, when at least one is known. */
export function connectedEngagements(p: ConnectedPostMetrics): number | null {
  const parts = [p.likes, p.comments, p.saves, p.shares].filter((v): v is number => typeof v === "number");
  return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
}

export function matchConnectedMetrics(
  creatives: { id: string; url: string | null; externalId: string | null }[],
  posts: ConnectedPostMetrics[],
  capturedAt: Date,
  source: string,
): MetricInput[] {
  const byRef = new Map<string, string>();
  for (const c of creatives) {
    if (c.externalId) byRef.set(c.externalId.trim(), c.id);
    if (c.url) byRef.set(refKey(c.url), c.id);
  }
  const out: MetricInput[] = [];
  for (const p of posts) {
    const creativeId = byRef.get(p.externalId) ?? (p.permalink ? byRef.get(refKey(p.permalink)) : undefined);
    if (!creativeId) continue;
    out.push({
      creativeId,
      capturedAt,
      source,
      impressions: null,
      reach: p.reach ?? null,
      clicks: null,
      engagements: connectedEngagements(p),
      saves: p.saves ?? null,
      shares: p.shares ?? null,
      videoViews: null,
      leads: null,
      spend: null,
    });
  }
  return out;
}

export type ConnectedSync = { connections: number; matched: number; failures: string[] };

export async function syncConnectedMetrics(workspaceId: string, now = new Date()): Promise<ConnectedSync> {
  const connections = (await listMetricConnections(workspaceId)).filter((c) => c.status === "connected");
  if (connections.length === 0) return { connections: 0, matched: 0, failures: [] };
  const creatives = await listCreatives(workspaceId);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let matched = 0;
  const failures: string[] = [];
  for (const c of connections) {
    try {
      const posts = await readConnectionPostMetrics(workspaceId, c.id);
      const rows = matchConnectedMetrics(creatives, posts, day, `connector:${c.provider}`);
      matched += await upsertMetricSnapshots(workspaceId, null, rows);
    } catch (error) {
      failures.push(`${c.label} (${c.provider}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { connections: connections.length, matched, failures };
}
