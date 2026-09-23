export type MetaCampaignMetrics = {
  spend: number;
  impressions: number;
  clicks: number;
  /** Leads and conversions only — never link clicks, engagement or video views. */
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
};

/**
 * Why no numbers came back. Every one of these writes nothing: a missing
 * metric is "not measured", never a made-up figure (C7.0; before it, this
 * module synthesised spend from the budget pace and saved it as real).
 */
export type MetaPullResult =
  | { status: "ok"; metrics: MetaCampaignMetrics }
  | { status: "not_connected"; reason: string }
  | { status: "no_data"; reason: string }
  | { status: "error"; reason: string };

/** Meta action types that are a lead or a conversion. */
const CONVERSION_ACTION = /^(lead|onsite_conversion\.lead_grouped|offsite_conversion\.[\w.]+|purchase|complete_registration|submit_application)$/;

type InsightRow = {
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
};

/** Pure: one Graph insights row -> metrics. Exported for tests. */
export function metricsFromInsight(row: InsightRow): MetaCampaignMetrics {
  const spend = Number.parseFloat(row.spend ?? "0") || 0;
  const impressions = Number.parseInt(row.impressions ?? "0", 10) || 0;
  const clicks = Number.parseInt(row.clicks ?? "0", 10) || 0;
  const conversions = (row.actions ?? [])
    .filter((a) => CONVERSION_ACTION.test(a.action_type))
    .reduce((sum, a) => sum + (Number.parseInt(a.value, 10) || 0), 0);
  const round = (n: number) => Number(n.toFixed(2));
  return {
    spend,
    impressions,
    clicks,
    conversions,
    ctr: impressions > 0 ? round((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? round(spend / clicks) : 0,
    cpa: conversions > 0 ? round(spend / conversions) : 0,
  };
}

/**
 * Reads one Meta campaign's insights. Needs the campaign's id in Meta (not
 * our row id) and an access token; the token travels in the Authorization
 * header, never in the URL (URLs end up in logs).
 */
export async function pullMetaCampaignMetrics(input: {
  metaCampaignId: string | null;
  accessToken: string | null;
  fetchImpl?: typeof fetch;
}): Promise<MetaPullResult> {
  if (!input.accessToken || !input.metaCampaignId) {
    return {
      status: "not_connected",
      reason: "This campaign isn't linked to a Meta ad account, so there are no live numbers. Import them from a CSV instead.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(input.metaCampaignId)}/insights?fields=spend,impressions,clicks,actions`;
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { status: "error", reason: `Meta answered ${res.status}. Nothing was saved.` };
    const json = (await res.json()) as { data?: InsightRow[] };
    const row = json.data?.[0];
    if (!row) return { status: "no_data", reason: "Meta has no numbers for this campaign yet." };
    return { status: "ok", metrics: metricsFromInsight(row) };
  } catch {
    return { status: "error", reason: "Couldn't reach Meta. Nothing was saved." };
  }
}
