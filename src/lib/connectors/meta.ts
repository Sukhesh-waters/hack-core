import type { ParsedPostRow } from "@/lib/csv-import";

/**
 * Meta Graph API pull → first-party layer, behind META_CONNECTOR_ENABLED.
 * Endpoint fields are best-effort until app review unlocks live testing;
 * the output shape (ParsedPostRow) is the stable contract — it feeds the
 * same buildImportPlan pipeline as CSV import.
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export class MetaConnectorError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MetaConnectorError";
  }
}

type MediaItem = {
  id: string;
  caption?: string;
  timestamp?: string;
  media_type?: string;
  like_count?: number;
  comments_count?: number;
};

type InsightsPayload = {
  data?: { name: string; values?: { value?: number }[] }[];
};

async function fetchMediaInsights(
  mediaId: string,
  accessToken: string,
): Promise<{ reach?: number; saves?: number; shares?: number }> {
  try {
    const response = await fetch(
      `${GRAPH_BASE}/${mediaId}/insights?metric=reach,saved,shares&access_token=${accessToken}`,
    );
    if (!response.ok) return {};
    const payload = (await response.json()) as InsightsPayload;
    const metric = (name: string) =>
      payload.data?.find((m) => m.name === name)?.values?.[0]?.value;
    return {
      reach: metric("reach"),
      saves: metric("saved"),
      shares: metric("shares"),
    };
  } catch {
    return {}; // insights are enhancement — row stays importable, unscored
  }
}

export async function pullMetaMedia(
  igUserId: string,
  accessToken: string,
  limit = 50,
): Promise<ParsedPostRow[]> {
  const response = await fetch(
    `${GRAPH_BASE}/${igUserId}/media?fields=id,caption,timestamp,media_type,like_count,comments_count&limit=${limit}&access_token=${accessToken}`,
  );
  if (!response.ok) {
    throw new MetaConnectorError(
      `Meta media listing failed (${response.status})`,
      response.status,
    );
  }
  const payload = (await response.json()) as { data?: MediaItem[] };
  const media = payload.data ?? [];

  const rows: ParsedPostRow[] = [];
  for (const item of media) {
    const postedAt = new Date(item.timestamp ?? "");
    if (Number.isNaN(postedAt.getTime())) continue;
    const insights = await fetchMediaInsights(item.id, accessToken);
    rows.push({
      externalId: item.id,
      caption: item.caption,
      postedAt,
      likes: item.like_count,
      comments: item.comments_count,
      reach: insights.reach,
      saves: insights.saves,
      shares: insights.shares,
    });
  }
  return rows;
}
