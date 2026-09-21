/**
 * The degradation ladder made visible (core spine S7). Pure: turns collection
 * facts into the notices a user must see — provider swapped, collection
 * paused, knowledge stale. Silence is the bug this exists to prevent.
 */
import { checkScheduler, type SpecActivity } from "./health";

export type DegradationNotice = {
  id: string;
  tone: "warn" | "error";
  text: string;
  href?: string;
  hrefLabel?: string;
};

export const KB_STALE_DAYS = 7;
export const PROVIDER_WINDOW_HOURS = 6;

export function buildDegradationNotices(input: {
  now: Date;
  workspaceId: string;
  specs: SpecActivity[];
  latestRunEventAt: Date | null;
  devMode: boolean;
  pagesToday: number;
  dailyCap: number;
  /** The newest signal document's fetch time, or null when there is none. */
  lastDocumentAt: Date | null;
  latestRun: { status: string; degradedReason: string | null; errorReason: string | null } | null;
  devServer?: "up" | "down" | "not_dev";
  /** AI provider attempts that failed recently: the ladder swapping providers. */
  providerFailures?: {
    provider: string;
    model: string;
    failures: number;
    lastError?: string | null;
  }[];
}): DegradationNotice[] {
  const notices: DegradationNotice[] = [];
  const health = `/p/${input.workspaceId}/admin/health`;

  const scheduler = checkScheduler({
    now: input.now,
    specs: input.specs,
    latestRunEventAt: input.latestRunEventAt,
    devMode: input.devMode,
    devServer: input.devServer,
  });
  if (scheduler.status !== "ok") {
    notices.push({
      id: "scheduler",
      tone: "error",
      text: `Collection looks stopped. ${scheduler.detail}`,
      href: health,
      hrefLabel: "See how to fix it",
    });
  }

  if (input.specs.length > 0 && input.pagesToday >= input.dailyCap) {
    notices.push({
      id: "cap",
      tone: "warn",
      text: `Collection is paused for today: the daily limit of ${input.dailyCap} pages is reached. It resumes at 00:00 UTC.`,
      href: health,
      hrefLabel: "Details",
    });
  }

  const swaps = (input.providerFailures ?? []).filter((p) => p.failures > 0);
  if (swaps.length > 0) {
    const detail = swaps
      .map(
        (p) =>
          `${p.provider} (${p.model}) failed ${p.failures} time${p.failures === 1 ? "" : "s"}` +
          (p.lastError?.includes("daily quota")
            ? " — its daily free-tier quota is used up until it resets"
            : ""),
      )
      .join(", ");
    notices.push({
      id: "provider",
      tone: "warn",
      text: `AI provider fallback in the last ${PROVIDER_WINDOW_HOURS} hours: ${detail}. Answers came from the backup provider.`,
      href: health,
      hrefLabel: "Run the provider check",
    });
  }

  const run = input.latestRun;
  if (run && (run.status === "degraded" || run.status === "failed")) {
    notices.push({
      id: "run",
      tone: run.status === "failed" ? "error" : "warn",
      text: `The latest collection run ${run.status}: ${run.degradedReason ?? run.errorReason ?? "no reason recorded"}.`,
      href: `/p/${input.workspaceId}/audits`,
      hrefLabel: "Open runs",
    });
  }

  if (input.specs.length > 0 && input.lastDocumentAt) {
    const days = Math.floor(
      (input.now.getTime() - input.lastDocumentAt.getTime()) / 86_400_000,
    );
    if (days >= KB_STALE_DAYS) {
      notices.push({
        id: "stale",
        tone: "warn",
        text: `Nothing new has been collected for ${days} days, so what we know may be out of date.`,
      });
    }
  }
  return notices;
}
