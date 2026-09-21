/**
 * One plain sentence about what is happening with a source, from real run
 * state. Pure, so the wording and the "is anything in flight?" flag (which
 * drives the client page's auto-refresh) are tested rather than eyeballed.
 */
export type RunRow = {
  specId: string | null;
  status: string;
  queuedAt: Date;
  counters: Record<string, number>;
  errorReason: string | null;
  degradedReason: string | null;
};

/** A queued run older than this is probably waiting on a job runner that is not there. */
export const QUEUED_STUCK_MINUTES = 2;

export function runSummary(
  run: RunRow | undefined,
  now: Date,
): { text: string; active: boolean } {
  if (!run) return { text: "Not run yet", active: false };
  const waitedMin = Math.floor((now.getTime() - run.queuedAt.getTime()) / 60_000);
  switch (run.status) {
    case "queued":
      return {
        text:
          waitedMin >= QUEUED_STUCK_MINUTES
            ? "Queued, waiting for the job runner (is it running? see collection health)"
            : "Queued",
        active: true,
      };
    case "running":
      return { text: "Reading pages…", active: true };
    case "validating":
      return { text: "Analysing…", active: true };
    case "completed":
      return {
        text: `Done: ${run.counters.fetched ?? 0} page(s), ${run.counters.inserted ?? 0} new`,
        active: false,
      };
    case "degraded":
      return { text: `Finished with problems: ${run.degradedReason ?? "see runs"}`, active: false };
    case "failed":
      return { text: `Failed: ${run.errorReason ?? "see runs"}`, active: false };
    default:
      return { text: run.status, active: false };
  }
}
