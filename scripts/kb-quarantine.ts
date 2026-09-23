/**
 * C7.0 T0.1: take other companies' pages out of a client's first-party
 * knowledge base (two-layer rule), and clear dead ingest rows.
 *
 *   npx tsx scripts/kb-quarantine.ts --ws waters-gcc-internal --client waters \
 *     --own "waters.com,linkedin.com/company/waters,linkedin.com/showcase/bdbiosciences" [--apply]
 *
 * Dry run by default: prints what it would do. --apply:
 *   1. adds the --own identities to the client's own list (source "seed");
 *   2. writes a JSON backup (sources + chunks, embeddings included) to
 *      backups/<date>-kb-quarantine-<ws>.json;
 *   3. deletes the sources that are not the client's own (chunks cascade),
 *      and failed/stuck rows that hold no chunks.
 * Restore: --restore <backup file> re-inserts exactly what was deleted.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  process.loadEnvFile(".env.local");
  const { db } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { clients, knowledgeChunks, knowledgeSources, workspaces } = await import("@/db/schema");
  const ids = await import("@/db/queries/client-identities");
  const { ownershipOf, parseIdentity, describeIdentity } = await import("@/lib/ingest/ownership");
  const { INGEST_ORPHAN_AFTER_MS } = await import("@/lib/knowledge-ingest");

  const restore = arg("restore");
  if (restore) {
    const backup = JSON.parse(readFileSync(restore, "utf8")) as {
      sources: (typeof knowledgeSources.$inferSelect)[];
      chunks: (typeof knowledgeChunks.$inferSelect)[];
    };
    const revive = <T extends Record<string, unknown>>(row: T) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, /At$/.test(k) && typeof v === "string" ? new Date(v) : v])) as T;
    if (backup.sources.length) await db.insert(knowledgeSources).values(backup.sources.map(revive)).onConflictDoNothing();
    for (let i = 0; i < backup.chunks.length; i += 200) {
      await db.insert(knowledgeChunks).values(backup.chunks.slice(i, i + 200).map(revive)).onConflictDoNothing();
    }
    console.log(`restored ${backup.sources.length} sources, ${backup.chunks.length} chunks from ${restore}`);
    process.exit(0);
  }

  const slug = arg("ws");
  const clientName = arg("client");
  if (!slug || !clientName) throw new Error('usage: --ws <slug> --client <name> [--own "a.com,linkedin.com/company/x"] [--apply]');
  const apply = flag("apply");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, ws.id), eq(clients.name, clientName)));
  if (!client) throw new Error(`no client "${clientName}" in ${slug}`);

  const seed = (arg("own") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const identity = parseIdentity(s);
      if (!identity) throw new Error(`not a site or profile: "${s}"`);
      return identity;
    });
  const existing = await ids.listClientIdentities(ws.id, client.id);
  const own = [...existing.map(({ kind, value }) => ({ kind, value })), ...seed];
  if (own.length === 0) throw new Error("the client has no own sites yet: pass --own");
  const known = await ids.listKnownParties(ws.id);

  const sources = await db
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.workspaceId, ws.id), eq(knowledgeSources.clientId, client.id)));

  const now = Date.now();
  const notOwn = sources.filter((s) => s.url && ownershipOf(s.url, { own, known }).verdict !== "own");
  const dead = sources.filter(
    (s) =>
      !notOwn.includes(s) &&
      s.chunkCount === 0 &&
      (s.status === "failed" || (s.status === "pending" && now - s.createdAt.getTime() > INGEST_ORPHAN_AFTER_MS)),
  );

  console.log(`\n${slug} / ${client.name}: ${sources.length} knowledge sources`);
  console.log(`own list: ${own.map(describeIdentity).join(", ")}${seed.length ? ` (${seed.length} to add)` : ""}`);
  console.log(`\nNOT the client's own (${notOwn.length}):`);
  for (const s of notOwn) {
    const who = ownershipOf(s.url!, { own, known });
    console.log(`  - ${s.url}  [${who.verdict === "third_party" ? who.name : "unknown owner"}] ${s.status}, ${s.chunkCount} chunks`);
  }
  console.log(`\nfailed or stuck with no chunks (${dead.length}):`);
  for (const s of dead) console.log(`  - ${s.url ?? s.sourceKind}  ${s.status}${s.error ? `: ${s.error.slice(0, 80)}` : ""}`);
  const kept = sources.filter((s) => !notOwn.includes(s) && !dead.includes(s));
  console.log(`\nkept (${kept.length}): ${kept.reduce((n, s) => n + s.chunkCount, 0)} chunks`);
  for (const s of kept) console.log(`  = ${s.url ?? s.sourceKind}  ${s.status}, ${s.chunkCount} chunks`);

  if (!apply) {
    console.log("\nDry run. Nothing changed. Re-run with --apply.");
    process.exit(0);
  }

  for (const identity of seed) {
    await ids.addClientIdentity({ workspaceId: ws.id, clientId: client.id, identity, source: "seed", addedById: null });
  }
  const removeIds = [...notOwn, ...dead].map((s) => s.id);
  const chunks = removeIds.length
    ? await db
        .select()
        .from(knowledgeChunks)
        .where(and(eq(knowledgeChunks.workspaceId, ws.id), inArray(knowledgeChunks.sourceId, removeIds)))
    : [];
  mkdirSync("backups", { recursive: true });
  const file = `backups/${new Date().toISOString().slice(0, 10)}-kb-quarantine-${slug}.json`;
  writeFileSync(file, JSON.stringify({ workspace: slug, client: client.name, sources: [...notOwn, ...dead], chunks }, null, 1));
  console.log(`\nbackup: ${file} (${removeIds.length} sources, ${chunks.length} chunks)`);

  if (removeIds.length) {
    await db
      .delete(knowledgeSources)
      .where(and(eq(knowledgeSources.workspaceId, ws.id), inArray(knowledgeSources.id, removeIds)));
  }
  console.log(`deleted ${removeIds.length} sources (${chunks.length} chunks). Restore with --restore ${file}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
