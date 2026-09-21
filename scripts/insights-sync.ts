/**
 * Refresh the measured market insights in the Brain (C5) — the same step the
 * interest and event jobs run at their end.
 *
 *   npx tsx scripts/insights-sync.ts --ws waters-gcc-internal [--show]
 *
 * --show prints the active insight chunks afterwards.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  if (!slug) throw new Error("usage: --ws <slug> [--show]");
  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const { syncClientInsights, syncEventInsights } = await import("@/lib/platina/market-insight-sync");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  for (const client of (await q.listBrands(ws.id)).filter((b) => b.kind === "own_brand")) {
    console.log(`${client.name}:`, JSON.stringify(await syncClientInsights(ws.id, client.id)));
  }
  console.log("events:", JSON.stringify(await syncEventInsights(ws.id)));

  if (process.argv.includes("--show")) {
    for (const prefix of ["interest:", "pressure:", "event:"]) {
      for (const c of await q.listActiveInsightChunks(ws.id, prefix)) console.log(`\n[${c.insightKey}]\n${c.content}`);
    }
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
