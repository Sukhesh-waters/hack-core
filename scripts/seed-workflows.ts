/**
 * W1 one-off: seed the default content workflow into every existing
 * workspace and backfill their content rows.
 *
 * New workspaces are seeded lazily by ensureContentWorkflow, so this exists
 * only to catch up the ones that predate the engine.
 *
 * Run: npx tsx scripts/seed-workflows.ts
 */
import * as fs from "fs";
import * as path from "path";

// Same manual .env.local parser drizzle.config.ts uses — this repo
// deliberately has no dotenv dependency.
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  const { db } = await import("../src/db");
  const { workspaces } = await import("../src/db/schema");
  const { seedContentWorkflow } = await import(
    "../src/db/queries/workflow-seed"
  );

  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces);

  console.log(`Seeding ${rows.length} workspace(s)…\n`);
  for (const ws of rows) {
    const result = await seedContentWorkflow(ws.id);
    console.log(
      `  ${ws.name}: workflow ${result.created ? "created" : "already existed"}, ` +
        `${result.backfilled} content row(s) backfilled`,
    );
  }
  console.log("\nDone.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
