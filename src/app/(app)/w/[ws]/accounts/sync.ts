import { db } from "@/db";
import { posts } from "@/db/schema";
import { getConnectedAccount, updateHeartbeat } from "@/db/queries/accounts";
import {
  getBaselinePoints,
  listExistingPostExternalIds,
} from "@/db/queries/posts";
import { pullMetaMedia } from "@/lib/connectors/meta";
import { decryptSecret } from "@/lib/crypto";
import { dedupeItems } from "@/lib/harness";
import { embedPosts } from "@/lib/embed-posts";
import { buildImportPlan } from "@/lib/import-pipeline";
import { normalizeCaptions } from "@/lib/normalize";
import { runWithAiCost } from "@/lib/ai/usage-context";

type ConnectedAccount = NonNullable<
  Awaited<ReturnType<typeof getConnectedAccount>>
>;

/**
 * Core Meta sync logic shared by the manual "Sync now" server action
 * (accounts/actions.ts) and the hourly account-sync cron
 * (inngest/functions/account-sync.ts). No Next.js-specific side effects
 * here (no revalidatePath) — callers own their own UI invalidation.
 *
 * Pulls first-party media, normalizes + embeds it into the baseline
 * (two-layer rule: first-party only), and updates the connection
 * heartbeat. Throws on failure — callers decide how to report/record it.
 *
 * pullMetaMedia always re-fetches the account's latest media (no "since
 * last pull" cursor), so every sync must dedupe against posts already
 * stored for this client or re-runs would insert duplicates and skew the
 * baseline every single tick.
 */
export async function runAccountSync(
  workspaceId: string,
  account: ConnectedAccount,
) {
  const pulled = await pullMetaMedia(
    account.igUserId,
    decryptSecret(account.accessTokenEnc),
  );
  const existingIds = await listExistingPostExternalIds(
    workspaceId,
    account.clientId,
    pulled.flatMap((row) => (row.externalId ? [row.externalId] : [])),
  );
  // Same dedup helper the pattern-layer path uses (lib/harness.ts): filter
  // out media already stored for this client before it re-enters the baseline.
  const rows = dedupeItems(pulled, existingIds);
  if (rows.length > 0) {
    await runWithAiCost({ workspaceId, purpose: "sync" }, async () => {
      const meta = await normalizeCaptions(rows.map((row) => row.caption));
      const existingBaseline = await getBaselinePoints(
        workspaceId,
        account.clientId,
      );
      const planned = buildImportPlan({
        workspaceId,
        clientId: account.clientId,
        importJobId: account.id, // provenance: which connection produced these
        rows,
        meta,
        existingBaseline,
      });
      const inserted = await db
        .insert(posts)
        .values(planned)
        .returning({ id: posts.id, caption: posts.caption });
      await embedPosts(workspaceId, inserted);
    });
  }
  await updateHeartbeat(workspaceId, account.id, {
    status: "connected",
    lastPullAt: new Date(),
    lastError: null,
  });
}
