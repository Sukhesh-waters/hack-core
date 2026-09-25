/**
 * Where the market gathers, and who is there — for one client (C4).
 *
 *   npx tsx scripts/events-report.ts --ws waters-gcc-internal --client Waters [--extract] [--days 120]
 *
 * --extract first runs the same extraction the job runs, over documents
 * collected in the last --days (default 120). Then it prints upcoming events
 * (Gulf first), each with its date words, place, proof URL, and which of the
 * client's competitors have a named proof of being there. Past events are
 * listed after, as history.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  const clientName = arg("client");
  if (!slug || !clientName) throw new Error("usage: --ws <slug> --client <name> [--extract] [--days N]");

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const { routeAI } = await import("@/lib/ai/router");
  const { extractEventsForWorkspace, EVENT_LOOKBACK_DAYS } = await import("@/lib/platina/event-extract");
  const { daysUntil, eventTiming, isGcc } = await import("@/lib/platina/events");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const brands = await q.listBrands(ws.id);
  const client = brands.find((b) => b.kind === "own_brand" && b.name.toLowerCase() === clientName.toLowerCase());
  if (!client) throw new Error(`no client "${clientName}"`);
  const competitors = await q.listCompetitorsOf(ws.id, client.id);
  const names = new Map([[client.id, client.name], ...competitors.map((c) => [c.id, c.name] as [string, string])]);

  if (process.argv.includes("--extract")) {
    const started = Date.now();
    const result = await extractEventsForWorkspace(
      {
        listDocs: (w, since) => q.listEventSourceDocs(w, since),
        listBrands: async () => brands.map((b) => ({ id: b.id, name: b.name })),
        listEvents: async (w) =>
          (await q.listEvents(w)).map((e) => ({ eventKey: e.eventKey, name: e.name, startsOn: e.startsOn, country: e.country })),
        ask: (prompt) => routeAI({ kind: "chat", tier: "fast", json: true, prompt, workload: "background" }),
        upsertEvent: (row) => q.upsertEvent(row),
        insertParticipants: (rows) => q.insertEventParticipants(rows),
      },
      { workspaceId: ws.id, lookbackDays: Number(arg("days") ?? EVENT_LOOKBACK_DAYS) },
    );
    console.log(`\nExtraction (${Date.now() - started}ms):`, JSON.stringify(result));
  }

  const now = new Date();
  const events = await q.listEvents(ws.id);
  const people = await q.listEventParticipants(ws.id, events.map((e) => e.id));
  const EVIDENCE: Record<string, string> = {
    listed_exhibitor: "on the exhibitor list",
    mentioned_on_event_page: "named on the event page",
    announced_in_post: "announced in its own post",
  };

  const line = (e: (typeof events)[number]) => {
    const when = e.startsOn ? `${e.startsOn}${e.endsOn && e.endsOn !== e.startsOn ? `..${e.endsOn}` : ""}` : "date not stated";
    const soon = e.startsOn && eventTiming(e, now) === "upcoming" ? ` (in ${daysUntil(e.startsOn, now)} days)` : "";
    const where = e.format === "online" ? "online" : [e.location, e.country].filter(Boolean).join(", ") || "place not stated";
    console.log(`  ${isGcc(e.country) ? "★ " : "  "}${e.name} — ${when}${soon} — ${where}`);
    console.log(`      proof: ${e.sourceUrl}${e.dateText ? `  ("${e.dateText}")` : ""}`);
    const here = people.filter((p) => p.eventId === e.id && names.has(p.brandId));
    for (const p of here) {
      console.log(`      ${p.brandId === client.id ? "you" : "competitor"}: ${names.get(p.brandId)} — ${EVIDENCE[p.evidence] ?? p.evidence}  ${p.sourceUrl}`);
    }
    if (here.length === 0) {
      const read = (e.detail as { readAt?: string } | null)?.readAt;
      console.log(`      no competitor named ${read ? `on the page read ${read.slice(0, 10)}` : "in any post read"} (not proof of absence)`);
    }
  };

  const upcoming = events
    .filter((e) => ["upcoming", "happening"].includes(eventTiming(e, now)))
    .sort((a, b) => Number(isGcc(b.country)) - Number(isGcc(a.country)) || (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
  console.log(`\n${client.name} — ${events.length} events known, ${upcoming.length} upcoming (★ = Gulf)\n`);
  console.log("UPCOMING");
  upcoming.forEach(line);
  const undated = events.filter((e) => eventTiming(e, now) === "undated");
  if (undated.length) {
    console.log("\nDATE NOT STATED (seen in posts or pages without a date)");
    undated.forEach(line);
  }
  const past = events.filter((e) => eventTiming(e, now) === "past");
  if (past.length) {
    console.log("\nPAST (history — who went where)");
    past.forEach(line);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
