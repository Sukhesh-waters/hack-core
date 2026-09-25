/**
 * The ops board from the command line (C7.1). Read-only; exit 1 on any red.
 *
 *   npm run ops:check -- --ws waters-gcc-internal [--no-external] [--json]
 *
 * Runs the same checks as the hourly job and Admin -> Health (lib/ops), so
 * the script and the board can never disagree. --no-external skips reading
 * Apify and Firecrawl account usage.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const MARK = { ok: "OK  ", degraded: "WARN", down: "RED ", not_configured: "--  " } as const;

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  if (!slug) throw new Error("usage: --ws <workspace slug> [--no-external] [--json]");
  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { runOpsChecks } = await import("@/lib/ops/collect");
  const { opsTotals } = await import("@/lib/ops/checks");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const checks = await runOpsChecks(ws.id, { external: !process.argv.includes("--no-external") });
  const totals = opsTotals(checks);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ workspace: slug, ...totals, checks }, null, 2));
  } else {
    console.log(`\nops:check ${slug}`);
    for (const c of checks) {
      console.log(`  [${MARK[c.status]}] ${c.label}: ${c.detail}`);
      if (c.remedy && c.status !== "ok") console.log(`         next: ${c.remedy}`);
    }
    console.log(totals.redChecks === 0 ? `\nOK (${totals.amberChecks} amber)` : `\n${totals.redChecks} RED`);
  }
  process.exit(totals.redChecks === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
