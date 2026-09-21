import {
  getLatestDocumentAt,
  getLatestRunEventAt,
  getWorkspaceConfig,
  getWorkspacePagesToday,
  listAuditRuns,
  listProviderFailuresSince,
  listScanSpecs,
} from "@/db/queries/platina";
import { DegradationBanner } from "@/components/platina/degradation-banner";
import { isProbeCapable } from "@/lib/platina/fetch/schedule";
import { probeInngestDev } from "@/lib/platina/inngest-dev";
import {
  PROVIDER_WINDOW_HOURS,
  buildDegradationNotices,
} from "@/lib/platina/degradation";

/** Self-contained server banner: reads the facts, shows what is not right. */
export async function CollectionBanner({ workspaceId }: { workspaceId: string }) {
  const now = new Date();
  const [specs, runs, latestRunEventAt, lastDocumentAt, pagesToday, config, providerFailures] =
    await Promise.all([
      listScanSpecs(workspaceId),
      listAuditRuns(workspaceId, 1),
      getLatestRunEventAt(workspaceId),
      getLatestDocumentAt(workspaceId),
      getWorkspacePagesToday(workspaceId, now.toISOString().slice(0, 10)),
      getWorkspaceConfig(workspaceId),
      listProviderFailuresSince(
        workspaceId,
        new Date(now.getTime() - PROVIDER_WINDOW_HOURS * 3_600_000),
      ),
    ]);
  const live = specs.filter((s) => s.status === "approved" && s.enabled);
  const notices = buildDegradationNotices({
    now,
    workspaceId,
    specs: live.map((s) => ({
      cadenceMinutes: s.cadenceMinutes,
      probeCapable: isProbeCapable(s.targets[0]?.kind ?? "competitor_site"),
      lastProbeAt: s.lastProbeAt,
      lastRunAt: s.lastRunAt,
    })),
    latestRunEventAt,
    devMode: Boolean(process.env.INNGEST_DEV),
    devServer: await probeInngestDev(),
    pagesToday,
    dailyCap: config?.dailyActorCallCap ?? 40,
    lastDocumentAt,
    providerFailures,
    latestRun: runs[0]
      ? {
          status: runs[0].status,
          degradedReason: runs[0].degradedReason,
          errorReason: runs[0].errorReason,
        }
      : null,
  });
  return <DegradationBanner notices={notices} />;
}
