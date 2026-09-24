/**
 * Starts an ad scan (C8.3): for each advertiser in the plan, the approved
 * weekly LinkedIn Ad Library source (created with its confirm gate the first
 * time, or pointed at a corrected advertiser name), then one collection run
 * carrying an operator seed grant for that many ads. Shared by the Ads page's
 * Scan now and `npm run platina:ads-sweep`, so both go through the same plan,
 * budget gate and pipeline. Server-only: writes the DB.
 */
import {
  approveScanSpec,
  createAuditRun,
  getWorkspaceConfig,
  insertGateEvent,
  insertScanSpec,
  listBrands,
  listCompetitorsOf,
  listScanSpecs,
  updateScanSpecTargets,
} from "@/db/queries/platina";
import { readApifyMonth } from "./fetch/apify-usage";
import { isLinkedInAdLibrary } from "./fetch/actors";
import { planAdScan, type AdScanPlan } from "./ads-scan";
import { assertCompleteGateEvent } from "./gates";
import { hashGatePayload } from "./hash";
import { snapshotRunConfig } from "./orchestrator";

const WEEKLY = 7 * 24 * 60;

export async function prepareAdScan(
  workspaceId: string,
  opts: { advertisers?: Map<string, string>; perAdvertiser?: number; approveOver?: boolean } = {},
): Promise<{ plan: AdScanPlan; resetsOn: string | null; usedUsd: number | null; capUsd: number | null } | null> {
  const brands = await listBrands(workspaceId);
  const client = brands.find((b) => b.kind === "own_brand" && b.status === "active");
  if (!client) return null;
  const [competitors, specs, apify] = await Promise.all([
    listCompetitorsOf(workspaceId, client.id),
    listScanSpecs(workspaceId),
    readApifyMonth(),
  ]);
  const plan = planAdScan({
    brands: [{ id: client.id, name: client.name, isClient: true }, ...competitors.map((c) => ({ id: c.id, name: c.name, isClient: false }))],
    specs: specs.map((s) => ({ id: s.id, brandId: s.brandId, status: s.status, targets: s.targets })),
    advertisers: opts.advertisers,
    perAdvertiser: opts.perAdvertiser,
    apify,
    approveOver: opts.approveOver,
  });
  return { plan, resetsOn: apify?.resetsOn ?? null, usedUsd: apify?.usedUsd ?? null, capUsd: apify?.capUsd ?? null };
}

/** Sources and runs for an allowed plan. Returns one run per advertiser. */
export async function startAdScan(
  workspaceId: string,
  userId: string,
  plan: AdScanPlan,
  trigger: "manual" | "operator" = "manual",
): Promise<{ brandId: string; name: string; runId: string }[]> {
  if (!plan.allowed) throw new Error(plan.reason ?? "scan not allowed");
  const specs = await listScanSpecs(workspaceId);
  const config = await getWorkspaceConfig(workspaceId);
  const stamp = Date.now();
  const runs: { brandId: string; name: string; runId: string }[] = [];
  for (const row of plan.rows) {
    const target = { kind: "ad_library" as const, value: row.url, maxPages: row.maxAds };
    let specId = row.specId;
    if (specId) {
      const spec = specs.find((s) => s.id === specId);
      const current = spec?.targets.find((t) => t.kind === "ad_library" && isLinkedInAdLibrary(t.value));
      if (spec && (current?.value !== row.url || current?.maxPages !== row.maxAds)) {
        // A corrected advertiser name: the same source now searches the right one.
        await updateScanSpecTargets(workspaceId, spec.id, [
          ...spec.targets.filter((t) => !(t.kind === "ad_library" && isLinkedInAdLibrary(t.value))),
          target,
        ]);
      }
      if (spec && spec.status !== "approved") await approveScanSpec(workspaceId, spec.id);
    } else {
      specId = await insertScanSpec({
        workspaceId,
        name: `${row.name} · LinkedIn ads`,
        targets: [target],
        cadenceMinutes: WEEKLY,
        createdById: userId,
        brandId: row.brandId,
      });
      await approveScanSpec(workspaceId, specId);
      const gate = {
        workspaceId,
        gate: "confirm" as const,
        decision: "approved" as const,
        approverId: userId,
        payloadHash: hashGatePayload({ specId, url: row.url }),
        subjectType: "scan_spec",
        subjectId: specId,
      };
      assertCompleteGateEvent(gate);
      await insertGateEvent(gate);
    }
    const runId = await createAuditRun({
      workspaceId,
      specId,
      trigger: "manual",
      idempotencyKey: `ads:${trigger}:${specId}:${stamp}`,
      configSnapshot: { ...snapshotRunConfig(config), seedPages: row.maxAds },
    });
    if (runId) runs.push({ brandId: row.brandId, name: row.name, runId });
  }
  return runs;
}
