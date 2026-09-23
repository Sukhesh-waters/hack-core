/**
 * Set a workspace's profile (division, region, business unit) — the same
 * write as Admin -> Workspace profile (C8.0 F0.2). Dry run by default.
 *
 *   npx tsx scripts/workspace-profile.ts --ws waters-gcc-internal \
 *     --division "Waters (incl. BD Biosciences)" [--region "GCC (Middle East)"] [--unit "..."] [--apply]
 *
 * Without --region it takes the region of the workspace's own client, so the
 * profile and the client never disagree.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  if (!slug) throw new Error('usage: --ws <slug> --division "..." [--region "..."] [--unit "..."] [--apply]');

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const own = (await q.listBrands(ws.id)).find((b) => b.kind === "own_brand" && b.status === "active");
  const patch = {
    division: arg("division"),
    region: arg("region") ?? own?.region ?? undefined,
    businessUnit: arg("unit"),
  };
  const before = await q.getWorkspaceProfile(ws.id);
  console.log("now:   ", before ? { division: before.division, region: before.region, businessUnit: before.businessUnit } : "no profile");
  console.log("set:   ", patch);
  if (!process.argv.includes("--apply")) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    process.exit(0);
  }
  await q.upsertWorkspaceProfile(ws.id, patch);
  console.log("\nSaved.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
