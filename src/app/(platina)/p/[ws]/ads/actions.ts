"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { inngest } from "@/inngest/client";
import { prepareAdScan, startAdScan } from "@/lib/platina/ads-scan-run";

/**
 * Scan now (C8.3): reads the LinkedIn Ad Library for the client and each
 * competitor, under the advertiser names on the form. The plan and the
 * budget gate are computed again here, from Apify's own usage: a page left
 * open for an hour never starts a scan the month can no longer pay for.
 */
export async function scanAdsAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const back = (params: Record<string, string>) => redirect(`/p/${ws}/ads?${new URLSearchParams(params)}`);
  const user = await requireUser();
  await requireMembership(ws, user.id);

  const advertisers = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("advertiser:") && typeof value === "string" && value.trim()) {
      advertisers.set(key.slice("advertiser:".length), value.trim().slice(0, 120));
    }
  }
  const prepared = await prepareAdScan(ws, { advertisers });
  if (!prepared) back({ error: "Add a client first." });
  if (!prepared!.plan.allowed) back({ error: prepared!.plan.reason ?? "The scan was not started." });

  const runs = await startAdScan(ws, user.id, prepared!.plan);
  if (runs.length === 0) back({ error: "No scan was started; try again." });
  try {
    await inngest.send(runs.map((r) => ({ name: "platina/audit-run.requested", data: { runId: r.runId, workspaceId: ws } })));
  } catch {
    back({ error: "The background job runner is not running. Start it with npm run dev:all, then scan again." });
  }
  back({ runs: runs.map((r) => r.runId).join(",") });
}
