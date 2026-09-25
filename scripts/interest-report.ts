/**
 * What is the market interested in, right now — for one client (C3).
 *
 *   npx tsx scripts/interest-report.ts --ws waters-gcc-internal --client Waters [--extract]
 *
 * --extract first runs the same extraction the job runs (topic assignment
 * uses a few model calls; numbers never come from a model). Then it prints
 * topic momentum from the stored signals: interest first, then competitor
 * pressure, each with its strongest proofs, and "insufficient signal" where
 * the sample is too small to mean anything.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  const clientName = arg("client");
  if (!slug || !clientName) throw new Error("usage: --ws <slug> --client <name> [--extract]");

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const { extractInterestForClient } = await import("@/lib/platina/interest-extract");
  const { assignTopics } = await import("@/lib/platina/interest-topics");
  const { topicMomentum, RECENT_DAYS, BASELINE_DAYS } = await import("@/lib/platina/interest");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const client = (await q.listBrands(ws.id)).find(
    (b) => b.kind === "own_brand" && b.name.toLowerCase() === clientName.toLowerCase(),
  );
  if (!client) throw new Error(`no client "${clientName}"`);
  const competitors = await q.listCompetitorsOf(ws.id, client.id);
  const names = new Map([[client.id, client.name], ...competitors.map((c) => [c.id, c.name] as [string, string])]);

  if (process.argv.includes("--extract")) {
    const started = Date.now();
    const result = await extractInterestForClient(
      {
        getClient: async (w, id) => {
          const b = await q.getBrand(w, id);
          return b ? { id: b.id, name: b.name, kind: b.kind, profile: b.profile ?? null } : null;
        },
        listCompetitorIds: async () => competitors.map((c) => c.id),
        listDocs: (w, ids, since) => q.listInterestSourceDocs(w, ids, since),
        assign: (texts, topics) => assignTopics(texts, topics),
        insert: (rows) => q.insertInterestSignals(rows),
        listKnownTopics: async (w, ids, since) => {
          const counts = new Map<string, number>();
          for (const s of await q.listInterestSignals(w, ids, since)) counts.set(s.topic, (counts.get(s.topic) ?? 0) + 1);
          return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([topic]) => topic);
        },
      },
      { workspaceId: ws.id, clientId: client.id },
    );
    console.log(`\nExtraction (${Date.now() - started}ms):`, JSON.stringify(result));
  }

  const now = new Date();
  const since = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000);
  const signals = await q.listInterestSignals(ws.id, [...names.keys()], since);
  const momentum = topicMomentum(signals, now);

  console.log(`\n${client.name} — ${signals.length} signals from ${names.size} companies\n`);
  for (const kind of ["interest", "pressure"] as const) {
    const rows = momentum.filter((m) => m.signalKind === kind);
    if (rows.length === 0) continue;
    console.log(
      kind === "interest"
        ? "WHAT PEOPLE ENGAGE WITH (engagement index: 1.0 = the company's typical post)"
        : "WHERE COMPETITORS ARE PAYING (days their ads have been running)",
    );
    for (const m of rows.slice(0, 15)) {
      const value = m.status === "ok" ? `recent ${m.recent}${m.baseline !== null ? ` vs ${m.baseline} before` : ""}` : "insufficient signal";
      console.log(`  ${m.topic.padEnd(32)} ${m.region.padEnd(7)} n=${String(m.n).padEnd(3)} ${value}`);
      if (m.status === "ok") {
        for (const p of m.proofs.slice(0, 2)) {
          const who = signals.find((s) => s.sourceUrl === p.sourceUrl)?.brandId;
          console.log(`      ${p.value}  ${names.get(who ?? "") ?? ""}  ${p.observedAt.toISOString().slice(0, 10)}  ${p.sourceUrl}`);
        }
      }
    }
    console.log("");
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
