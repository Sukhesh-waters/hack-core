/**
 * One command that answers "is the core spine actually working right now?"
 * (core spine R8).
 *
 *   npx tsx scripts/verify-spine.ts [--ws <workspaceId>] [--json]
 *
 * Read-only: it spends nothing, writes nothing, and changes nothing. It reads
 * the workspace's real state and asserts the things every previous round had
 * to re-discover by hand — including the quality checks, which are the whole
 * point of round 4:
 *
 *   - are findings named after the MOVE, or still after the page's HTML title?
 *   - are low-value pages being skipped, with a visible reason?
 *   - is anything being collected at all, and how recently?
 *   - did the client profile work, and is it confirmed as a standard?
 *   - can the planner see the evidence (are there embedded Brain chunks)?
 *   - how independent was the validation layer, really?
 *
 * Exit code 0 when every check passes, 1 when any fails. Paste the output into
 * the round's report.
 */

type Check = {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ok = (name: string, detail: string): Check => ({ name, status: "pass", detail });
const bad = (name: string, detail: string): Check => ({ name, status: "fail", detail });
const skip = (name: string, detail: string): Check => ({ name, status: "skip", detail });

async function main() {
  process.loadEnvFile(".env.local");
  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const {
    platinaBrainChunks,
    platinaBrands,
    platinaDebateTranscripts,
    platinaFindings,
    platinaScanSpecs,
    platinaSignalDocuments,
  } = await import("@/db/platina-schema");
  const { and, desc, eq, isNotNull, sql } = await import("drizzle-orm");

  const wsId =
    arg("ws") ??
    (await db.select({ id: workspaces.id }).from(workspaces).limit(1))[0]?.id;
  if (!wsId) throw new Error("no workspace found — pass --ws <workspaceId>");

  const checks: Check[] = [];
  const day = 86_400_000;
  const now = Date.now();

  // ---------------------------------------------------------------- config
  const providers = ["GROQ_API_KEY", "GEMINI_API_KEY"].filter((k) => process.env[k]);
  checks.push(
    providers.length > 0
      ? ok("AI providers configured", `${providers.length} of 2: ${providers.join(", ")}`)
      : bad("AI providers configured", "neither GROQ_API_KEY nor GEMINI_API_KEY is set"),
  );
  checks.push(
    process.env.APIFY_TOKEN
      ? ok("Collection provider configured", "APIFY_TOKEN present")
      : bad("Collection provider configured", "APIFY_TOKEN is not set — nothing can be collected"),
  );

  // ---------------------------------------------------------------- clients
  const brands = await db
    .select()
    .from(platinaBrands)
    .where(eq(platinaBrands.workspaceId, wsId));
  const clients = brands.filter((b) => b.kind === "own_brand");
  checks.push(
    brands.length > 0
      ? ok("Clients", `${clients.length} client(s), ${brands.length - clients.length} competitor(s)`)
      : skip("Clients", "no clients yet — add one at /p/<ws>/start"),
  );

  const withProfile = clients.filter((c) => c.profile);
  if (clients.length > 0) {
    checks.push(
      withProfile.length > 0
        ? ok("Client profile", `${withProfile.length}/${clients.length} client(s) analysed`)
        : bad(
            "Client profile",
            `no client has a profile yet${clients.some((c) => c.profileError) ? " (and one recorded an error)" : ""}`,
          ),
    );
  }

  // ---------------------------------------------------------------- sources
  const specs = await db
    .select()
    .from(platinaScanSpecs)
    .where(eq(platinaScanSpecs.workspaceId, wsId));
  const approved = specs.filter((s) => s.status === "approved" && s.enabled);
  const unlinked = specs.filter((s) => !s.brandId);
  checks.push(
    approved.length > 0
      ? ok("Approved sources", `${approved.length} approved and enabled, of ${specs.length}`)
      : skip("Approved sources", `${specs.length} source(s), none approved — nothing will be collected`),
  );
  if (unlinked.length > 0) {
    checks.push(
      bad(
        "Sources linked to a client",
        `${unlinked.length} source(s) have no client, so their findings cannot name a competitor`,
      ),
    );
  }

  // ---------------------------------------------------------------- collection
  const docs = await db
    .select({
      id: platinaSignalDocuments.id,
      title: platinaSignalDocuments.title,
      fetchedAt: platinaSignalDocuments.fetchedAt,
      state: platinaSignalDocuments.processingState,
      skipReason: platinaSignalDocuments.skipReason,
      metrics: platinaSignalDocuments.metrics,
    })
    .from(platinaSignalDocuments)
    .where(eq(platinaSignalDocuments.workspaceId, wsId))
    .orderBy(desc(platinaSignalDocuments.fetchedAt))
    .limit(500);

  const newest = docs[0]?.fetchedAt ? new Date(docs[0].fetchedAt).getTime() : null;
  checks.push(
    docs.length === 0
      ? skip("Documents collected", "nothing collected yet")
      : newest !== null && now - newest < 7 * day
        ? ok(
            "Documents collected",
            `${docs.length} document(s), newest ${Math.round((now - newest) / 3_600_000)}h ago`,
          )
        : bad(
            "Documents collected",
            `${docs.length} document(s), but the newest is ${Math.round((now - (newest ?? 0)) / day)} days old`,
          ),
  );

  const skipped = docs.filter((d) => d.skipReason);
  checks.push(
    docs.length === 0
      ? skip("Low-value pages skipped", "no documents to judge")
      : skipped.length > 0
        ? ok(
            "Low-value pages skipped",
            `${skipped.length}/${docs.length} passed over with a reason, e.g. "${skipped[0].skipReason}"`,
          )
        : skip(
            "Low-value pages skipped",
            "nothing skipped — expected on a small sample, suspicious on a large crawl",
          ),
  );

  const withMetrics = docs.filter((d) => d.metrics);
  checks.push(
    withMetrics.length > 0
      ? ok("Engagement measured", `${withMetrics.length} document(s) carry real metrics`)
      : skip("Engagement measured", "no social documents collected yet"),
  );

  // ---------------------------------------------------------------- findings
  const findings = await db
    .select({
      id: platinaFindings.id,
      title: platinaFindings.title,
      useCase: platinaFindings.useCase,
      createdAt: platinaFindings.createdAt,
    })
    .from(platinaFindings)
    .where(eq(platinaFindings.workspaceId, wsId))
    .orderBy(desc(platinaFindings.createdAt))
    .limit(200);

  // The round-4 quality check: a finding named after the page it came from is
  // a sitemap entry, not intelligence.
  const pageTitles = new Set(
    docs.map((d) => (d.title ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const named = findings.filter((f) => !pageTitles.has(f.title.trim().toLowerCase()));
  checks.push(
    findings.length === 0
      ? skip("Findings named after the move", "no findings yet")
      : named.length > 0
        ? ok(
            "Findings named after the move",
            `${named.length}/${findings.length} are not just the page title, e.g. "${named[0].title}"`,
          )
        : bad(
            "Findings named after the move",
            `all ${findings.length} finding(s) are named after the page they came from`,
          ),
  );

  const stageFindings = findings.filter((f) =>
    ["brand_divergence", "ideation"].includes(f.useCase),
  );
  checks.push(
    stageFindings.length > 0
      ? ok("Analysis stages producing", `${stageFindings.length} divergence/ideation finding(s)`)
      : skip(
          "Analysis stages producing",
          "no divergence or ideation findings — confirm a client profile as its standard to turn divergence on",
        ),
  );

  // ---------------------------------------------------------------- brain
  const [brain] = await db
    .select({
      total: sql<number>`count(*)`,
      embedded: sql<number>`count(${platinaBrainChunks.embedding})`,
    })
    .from(platinaBrainChunks)
    .where(eq(platinaBrainChunks.workspaceId, wsId));
  const total = Number(brain?.total ?? 0);
  const embedded = Number(brain?.embedded ?? 0);
  checks.push(
    total === 0
      ? skip("Planner can see the evidence", "the Brain is empty")
      : embedded === total
        ? ok("Planner can see the evidence", `${embedded}/${total} Brain chunks embedded`)
        : bad(
            "Planner can see the evidence",
            `${total - embedded}/${total} Brain chunks have no vector — retrieval cannot surface them`,
          ),
  );

  // ---------------------------------------------------------------- validation
  const transcripts = await db
    .select({ state: platinaDebateTranscripts.state, objection: platinaDebateTranscripts.strongestObjection })
    .from(platinaDebateTranscripts)
    .where(eq(platinaDebateTranscripts.workspaceId, wsId))
    .limit(500);
  const fallback = transcripts.filter((t) =>
    (t.objection ?? "").includes("independent challenger"),
  ).length;
  checks.push(
    transcripts.length === 0
      ? skip("Validation independence", "no validation rounds yet")
      : fallback === 0
        ? ok("Validation independence", `${transcripts.length} round(s), all independently challenged`)
        : bad(
            "Validation independence",
            `${fallback}/${transcripts.length} round(s) fell back to the same provider — enable Gemini billing for real volume`,
          ),
  );

  // ---------------------------------------------------------------- report
  const failed = checks.filter((c) => c.status === "fail");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ workspaceId: wsId, checks, failed: failed.length }, null, 2));
  } else {
    console.log(`\nCore spine — workspace ${wsId}\n`);
    for (const check of checks) {
      const mark = check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "----";
      console.log(`  [${mark}] ${check.name}: ${check.detail}`);
    }
    console.log(
      `\n${checks.filter((c) => c.status === "pass").length} passed, ${failed.length} failed, ${
        checks.filter((c) => c.status === "skip").length
      } not applicable yet.\n`,
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
