/**
 * Synthetic demo outcome seed (Slice 3.5, addendum A4).
 *
 * Inserts ONE clearly labelled synthetic outcome row for a workspace so the
 * vertical trace (solution → receipt → graded outcome) can be demonstrated
 * without real campaign data. The row is marked `synthetic: true` and
 * `source: "synthetic-demo"`; synthetic rows are structurally excluded from
 * evidence write-back, min-N baselines, and retrieval — they are demo data,
 * never evidence.
 *
 * Strictly additive and idempotent: it looks for an existing synthetic-demo
 * row in the workspace and reports instead of duplicating.
 *
 * Run:
 *   npx tsx scripts/platina-seed-synthetic-outcome.ts <workspaceId> [receiptId]
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const workspaceId = process.argv[2];
const receiptId = process.argv[3] ?? null;

async function main() {
  if (!workspaceId) {
    console.error("usage: npx tsx scripts/platina-seed-synthetic-outcome.ts <workspaceId> [receiptId]");
    process.exit(1);
  }
  const { db } = await import("../src/db");
  const { platinaOutcomes } = await import("../src/db/platina-schema");
  const { and, eq } = await import("drizzle-orm");

  const existing = await db
    .select({ id: platinaOutcomes.id })
    .from(platinaOutcomes)
    .where(
      and(
        eq(platinaOutcomes.workspaceId, workspaceId),
        eq(platinaOutcomes.synthetic, true),
        eq(platinaOutcomes.source, "synthetic-demo"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    console.log(`synthetic demo outcome already exists (${existing[0].id})`);
    process.exit(0);
  }

  const [row] = await db
    .insert(platinaOutcomes)
    .values({
      workspaceId,
      receiptId,
      leads: 42,
      qualifiedLeads: 17,
      conversionRate: 0.4048,
      pipelineContribution: 185000,
      qualityScore: 0.61,
      synthetic: true,
      source: "synthetic-demo",
    })
    .returning({ id: platinaOutcomes.id });
  console.log(`seeded synthetic demo outcome ${row.id} in workspace ${workspaceId}`);
  if (receiptId) console.log(`linked to receipt ${receiptId}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("synthetic outcome seed failed:", error);
  process.exit(1);
});
