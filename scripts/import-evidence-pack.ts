/**
 * Import an evidence pack (C8.0 F0.6): public pages an operator found by
 * research, each with the sentence that matters. Dry run by default.
 *
 *   npm run platina:evidence -- --ws waters-gcc-internal --pack path/to/pack.json [--apply]
 *
 * Pack format (lib/platina/evidence-pack.ts):
 *   { "gatheredBy": "Claude (operator, for the owner)", "gatheredAt": "2026-09-23",
 *     "items": [{ "url": "...", "quote": "exact sentence on the page", "why": "...",
 *                 "subject": "Agilent Technologies" | null, "kind": "press_release" }] }
 *
 * The dry run only sorts the items (whose page, refused and why); nothing is
 * read. --apply reads each kept URL once through Firecrawl (1 credit), keeps
 * it only if the quote is on the page, stores it as a public (Plane B) signal
 * document under "<company> · operator evidence" (an approved source the
 * scheduler never re-reads), then asks for the usual analysis and events jobs.
 */
import { readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const NEVER_MINUTES = 365 * 24 * 60;

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  const packPath = arg("pack");
  const apply = process.argv.includes("--apply");
  if (!slug || !packPath) throw new Error("usage: --ws <slug> --pack <file.json> [--apply]");

  const { db } = await import("@/db");
  const { memberships, workspaces } = await import("@/db/schema");
  const { platinaScanSpecs } = await import("@/db/platina-schema");
  const { and, eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const pack = await import("@/lib/platina/evidence-pack");

  const parsed = pack.packSchema.safeParse(JSON.parse(readFileSync(packPath, "utf8")));
  if (!parsed.success) throw new Error(`pack is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const evidence = parsed.data;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const brands = (await q.listBrands(ws.id)).map((b) => ({ id: b.id, name: b.name, kind: b.kind, homepageUrl: b.homepageUrl ?? null }));

  const triaged = evidence.items.map((item) => pack.triageItem(item, brands));
  console.log(`evidence pack: ${evidence.items.length} item(s) from ${evidence.gatheredBy}, ${evidence.gatheredAt}\n`);
  for (const t of triaged) {
    if (t.action === "refuse") console.log(`  - refused  ${t.url}\n             ${t.reason}`);
    else console.log(`  + ${(t.brandName ?? "Market").padEnd(26)} ${t.kind.padEnd(16)} ${t.url}`);
  }
  const toRead = triaged.filter((t): t is Extract<typeof t, { action: "read" }> => t.action === "read");
  console.log(`\n${toRead.length} to read (about ${toRead.length} Firecrawl credits).`);
  if (!apply) {
    console.log("Dry run — nothing read or written. Re-run with --apply.");
    process.exit(0);
  }

  const { scrapeWithFirecrawl } = await import("@/lib/scrape/firecrawl");
  const { mapFirecrawlPage } = await import("@/lib/platina/fetch/firecrawl-web");
  const { assertCompleteGateEvent } = await import("@/lib/platina/gates");
  const { hashGatePayload } = await import("@/lib/platina/hash");
  const { inngest } = await import("@/inngest/client");
  const [owner] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.role, "owner")));

  /** The approved, never-scheduled source that holds a company's pack pages. */
  const sourceFor = async (brandId: string | null, brandName: string | null, target: ReturnType<typeof pack.packTarget>) => {
    const name = pack.evidenceSourceName(brandName);
    const existing = (await q.listScanSpecs(ws.id)).find((s) => s.name === name);
    if (existing) {
      if (!existing.targets.some((t) => t.value === target.value)) {
        await db
          .update(platinaScanSpecs)
          .set({ targets: [...existing.targets, target], updatedAt: new Date() })
          .where(and(eq(platinaScanSpecs.workspaceId, ws.id), eq(platinaScanSpecs.id, existing.id)));
      }
      return existing.id;
    }
    const specId = await q.insertScanSpec({
      workspaceId: ws.id,
      name,
      targets: [target],
      cadenceMinutes: NEVER_MINUTES,
      createdById: owner.userId,
      brandId,
    });
    await q.approveScanSpec(ws.id, specId);
    const gate = {
      workspaceId: ws.id,
      gate: "confirm" as const,
      decision: "approved" as const,
      approverId: owner.userId,
      payloadHash: hashGatePayload({ specId }),
      subjectType: "scan_spec",
      subjectId: specId,
    };
    assertCompleteGateEvent(gate);
    await q.insertGateEvent(gate);
    // Held pages only: the scheduler never re-reads an operator-evidence source.
    await db
      .update(platinaScanSpecs)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(platinaScanSpecs.workspaceId, ws.id), eq(platinaScanSpecs.id, specId)));
    return specId;
  };

  let kept = 0;
  let dropped = 0;
  for (const t of toRead) {
    try {
      const page = await scrapeWithFirecrawl(t.url);
      if (!pack.quoteHolds(t.item.quote, page)) {
        dropped += 1;
        console.log(`  x dropped  ${t.url}: the quote is not on the page as read`);
        continue;
      }
      const target = pack.packTarget(t.kind, t.url);
      const specId = await sourceFor(t.brandId, t.brandName, target);
      const doc = mapFirecrawlPage(page, target);
      doc.raw = { ...(doc.raw as Record<string, unknown>), ...pack.packProvenance(evidence, t.item) };
      const inserted = await q.insertSignalDocuments(ws.id, specId, [doc]);
      kept += 1;
      console.log(`  ✓ kept     ${t.url}${inserted === 0 ? " (same page already stored)" : ""}`);
    } catch (error) {
      dropped += 1;
      console.log(`  x failed   ${t.url}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (kept > 0) {
    await inngest.send([
      { name: "platina/contradict.requested", data: { workspaceId: ws.id } },
      { name: "platina/events.extract.requested", data: { workspaceId: ws.id } },
    ]);
  }
  console.log(`\nKept ${kept}, dropped ${dropped}. Analysis and event reading requested.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
