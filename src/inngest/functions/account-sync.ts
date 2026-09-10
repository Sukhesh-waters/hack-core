import { eq, sql } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { connectedAccounts } from "@/db/schema";
import { updateHeartbeat } from "@/db/queries/accounts";
import { metaConnectorEnabled } from "@/lib/flags";
import { actionErrorMessage } from "@/lib/action-errors";
import { chunk } from "@/lib/batch";
import { runAccountSync } from "@/app/(app)/w/[ws]/accounts/sync";

/** Fairness bounds for the hourly sweep: the account list is capped per tick
 * (oldest-pulled first, so a growing fleet degrades to "each account syncs at
 * least every few hours" instead of the tick timing out), and accounts run in
 * small concurrent batches so wall-clock stays roughly flat as the platform
 * fleet grows. Meta rate limits are per-account tokens, so a concurrency of 3
 * doesn't stack against a single quota. */
const SYNC_SWEEP_CAP = 60;
const SYNC_CONCURRENCY = 3;

/**
 * Hourly Meta account sync (kb/page.tsx claims the baseline "stays fresh
 * automatically" — this cron is what makes that true; previously sync was
 * manual-only via the "Sync now" button).
 *
 * Degradation ladder: when META_CONNECTOR_ENABLED is false, no-op cleanly
 * (no error, no partial work) — mirrors the flag check in accounts/actions.ts.
 *
 * Each tick syncs up to SYNC_SWEEP_CAP status="connected" accounts,
 * oldest-pulled first, in SYNC_CONCURRENCY-sized batches (fairness bounds
 * above). Per-account try/catch mirrors pattern-scan.ts's executeRule —
 * one account's failure never kills the sweep for the rest of the workspace
 * fleet. No revalidatePath here (no Next.js request context in a cron).
 */
async function syncAllConnectedAccounts() {
  if (!metaConnectorEnabled()) {
    return { synced: 0, failed: 0, skipped: "meta_connector_disabled" as const };
  }

  // Oldest-pulled first (never-pulled accounts lead) so a fleet larger than
  // the cap still rotates fairly across ticks instead of starving the tail.
  const accounts = await db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.status, "connected"))
    .orderBy(sql`${connectedAccounts.lastPullAt} asc nulls first`)
    .limit(SYNC_SWEEP_CAP);

  let synced = 0;
  let failed = 0;

  for (const batch of chunk(accounts, SYNC_CONCURRENCY)) {
    await Promise.all(
      batch.map(async (account) => {
        try {
          await runAccountSync(account.workspaceId, account);
          synced += 1;
        } catch (error) {
          console.error(
            `account-sync failed (ws ${account.workspaceId}, account ${account.id}):`,
            actionErrorMessage(error),
          );
          await updateHeartbeat(account.workspaceId, account.id, {
            status: "error",
            lastError: actionErrorMessage(error),
          }).catch(() => {});
          failed += 1;
        }
      }),
    );
  }

  return { synced, failed };
}

/**
 * Cron-only. Manual "Sync now" runs the shared runAccountSync directly from
 * the accounts server action (so the user gets immediate error feedback);
 * it deliberately does NOT go through an Inngest event. No "accounts/
 * sync.requested" trigger — nothing ever fired it and routing manual syncs
 * through Inngest would swallow the synchronous error the UI relies on.
 */
export const accountSync = inngest.createFunction(
  {
    id: "account-sync",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    return step.run("sync-connected-accounts", () => syncAllConnectedAccounts());
  },
);
