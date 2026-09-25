/**
 * Read-only post metrics from a workspace's connected accounts — the ONE
 * connector call Platina may make (owner decision 2026-09-22, CLAUDE.md;
 * allowlisted in src/lib/platina/boundary.test.ts). It never posts,
 * schedules, or writes anything to the platform or to InstaMedia tables.
 *
 * Instagram (Meta Graph) today. The token is decrypted in memory only for the
 * call and never returned. A missing metric is left undefined, never 0.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, connectedAccounts } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type MetricConnection = {
  id: string;
  provider: string;
  /** The InstaMedia client the account belongs to (a label, nothing else). */
  label: string;
  status: string;
  lastError: string | null;
};

export type ConnectedPostMetrics = {
  externalId: string;
  permalink: string | null;
  postedAt: Date | null;
  reach?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
};

export type GraphFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function listMetricConnections(workspaceId: string): Promise<MetricConnection[]> {
  return db
    .select({
      id: connectedAccounts.id,
      provider: connectedAccounts.provider,
      label: clients.name,
      status: connectedAccounts.status,
      lastError: connectedAccounts.lastError,
    })
    .from(connectedAccounts)
    .innerJoin(clients, eq(clients.id, connectedAccounts.clientId))
    .where(eq(connectedAccounts.workspaceId, workspaceId));
}

type MediaItem = {
  id: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

/** Pure over its fetch: the Graph reads for one Instagram account. */
export async function readInstagramPostMetrics(
  igUserId: string,
  accessToken: string,
  fetchImpl: GraphFetch,
  limit = 50,
): Promise<ConnectedPostMetrics[]> {
  const token = encodeURIComponent(accessToken);
  const listing = await fetchImpl(
    `${GRAPH_BASE}/${igUserId}/media?fields=id,permalink,timestamp,like_count,comments_count&limit=${limit}&access_token=${token}`,
  );
  if (!listing.ok) throw new Error(`Instagram media listing failed (${listing.status})`);
  const media = ((await listing.json()) as { data?: MediaItem[] }).data ?? [];

  const out: ConnectedPostMetrics[] = [];
  for (const item of media) {
    const posted = item.timestamp ? new Date(item.timestamp) : null;
    const row: ConnectedPostMetrics = {
      externalId: item.id,
      permalink: item.permalink ?? null,
      postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
      likes: item.like_count,
      comments: item.comments_count,
    };
    try {
      const res = await fetchImpl(`${GRAPH_BASE}/${item.id}/insights?metric=reach,saved,shares&access_token=${token}`);
      if (res.ok) {
        const data = ((await res.json()) as { data?: { name: string; values?: { value?: number }[] }[] }).data ?? [];
        const metric = (name: string) => data.find((m) => m.name === name)?.values?.[0]?.value;
        row.reach = metric("reach");
        row.saves = metric("saved");
        row.shares = metric("shares");
      }
    } catch {
      // Insights are optional: the post's own counts still stand.
    }
    out.push(row);
  }
  return out;
}

/** Recent post metrics for one connection in this workspace. */
export async function readConnectionPostMetrics(
  workspaceId: string,
  connectionId: string,
  fetchImpl: GraphFetch = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) }),
): Promise<ConnectedPostMetrics[]> {
  const [row] = await db
    .select({ igUserId: connectedAccounts.igUserId, token: connectedAccounts.accessTokenEnc, provider: connectedAccounts.provider })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, connectionId)))
    .limit(1);
  if (!row) throw new Error("Connection not found in this workspace.");
  if (row.provider !== "meta") throw new Error(`Reading ${row.provider} metrics is not supported yet.`);
  return readInstagramPostMetrics(row.igUserId, decryptSecret(row.token), fetchImpl);
}
