import { inngest } from "@/inngest/client";
import { failStalledImportJobs } from "@/db/queries/import-jobs";
import { stallCutoff } from "@/lib/batch";

/** CSV import is the constitution's Meta-down degradation path (Meta API
 * down → fall back to CSV import), so a crashed import must not be able to
 * wedge a job in "processing" forever — the import-jobs list would show an
 * eternal spinner with no way out. The UI already renders "failed" + the
 * error text (import-jobs list), so flipping the row after a generous grace
 * period is the whole fix; no retry logic needed. 30 minutes is comfortably
 * longer than any real parse takes, so it only fires on jobs that actually
 * crashed mid-run. */
const STALL_MINUTES = 30;

/**
 * Hourly stalled-import sweep. Cron-only — there is no manual trigger for
 * this (unlike account-sync's "Sync now" button, there's no user action that
 * corresponds to "declare my own import dead"). See import-jobs.ts for why
 * the underlying query is a documented cross-workspace exception.
 */
export const importTimeoutSweep = inngest.createFunction(
  {
    id: "import-timeout-sweep",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    return step.run("fail-stalled-import-jobs", async () => {
      const cutoff = stallCutoff(new Date(), STALL_MINUTES);
      const failed = await failStalledImportJobs(cutoff);
      return { failed };
    });
  },
);
