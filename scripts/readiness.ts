/**
 * What each Platina page shows right now, for one workspace (C8.0 F0.1).
 *
 *   npm run platina:readiness -- --ws waters-gcc-internal [--json]
 *
 * Read-only. Prints every page with its rows, its newest row and, when it is
 * empty or thin, why and the step that fills it. `--json` prints the rows for
 * the journey test. Same rules as the ops board's "Pages have content" check.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  if (!slug) throw new Error("usage: --ws <slug> [--json]");

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { pageFactsQuery } = await import("@/db/queries/ops");
  const { checkPagesHaveContent, pageReadiness } = await import("@/lib/ops/readiness-pages");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const [facts] = await pageFactsQuery(ws.id);
  const pages = pageReadiness(facts);
  const check = checkPagesHaveContent(pages);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ workspace: slug, check, pages }, null, 2));
    process.exit(0);
  }

  const mark = { content: "OK   ", thin: "THIN ", empty: "EMPTY" } as const;
  console.log(`readiness ${slug}\n`);
  for (const p of pages) {
    const newest = p.newest ? `  (newest ${p.newest.slice(0, 16)})` : "";
    console.log(`  [${mark[p.status]}] ${p.page.padEnd(20)} ${p.shows}${newest}`);
    if (p.gap) console.log(`          ${" ".repeat(20)} -> ${p.gap}`);
  }
  console.log(`\n${check.status === "ok" ? "OK" : "AMBER"}: ${check.detail}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
