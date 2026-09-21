/**
 * Live scraping check: which scraper actually reads a page, right now.
 *
 *   npx tsx scripts/verify-scraping.ts [url]
 *
 * Run it when a paste-a-URL ingest or a Platina collection goes quiet. It
 * prints both accounts' remaining credit, then reads one page the way each
 * flow does — so "blocked", "out of credits" and "unsupported site" are named
 * in seconds instead of surfacing as "Something went wrong".
 *
 * Costs ~3 Firecrawl credits (markdown only). Writes nothing to the database.
 */
const URL_UNDER_TEST = process.argv[2] ?? "https://www.waters.com/";

function line(label: string, detail: string) {
  console.log(`  ${label.padEnd(30)} ${detail}`);
}

async function timed<T>(label: string, run: () => Promise<T>, describe: (r: T) => string) {
  const started = Date.now();
  try {
    const result = await run();
    line(label, `OK in ${Date.now() - started}ms — ${describe(result)}`);
    return true;
  } catch (error) {
    line(label, `FAILED in ${Date.now() - started}ms — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  process.loadEnvFile(".env.local");
  const { firecrawlConfigured, firecrawlCredits, scrapeWithFirecrawl } = await import(
    "@/lib/scrape/firecrawl"
  );
  const { readPage } = await import("@/lib/knowledge-ingest");
  const { fetchViaWaters } = await import("@/lib/platina/fetch/waters");

  console.log(`\nAccounts`);
  line("FIRECRAWL_API_KEY", firecrawlConfigured() ? "set" : "NOT SET (paste-a-URL and Platina fall back to plain fetch / Apify)");
  if (process.env.FORECRAWL_API_KEY) line("FORECRAWL_API_KEY", "set — a typo; the code reads FIRECRAWL_API_KEY");
  const credits = await firecrawlCredits();
  line("Firecrawl credits left", credits === null ? "unknown" : String(credits));
  line("APIFY_TOKEN", process.env.APIFY_TOKEN ? "set" : "NOT SET");

  console.log(`\nReading ${URL_UNDER_TEST}`);
  let failures = 0;
  const ok = [
    await timed("Firecrawl directly", () => scrapeWithFirecrawl(URL_UNDER_TEST), (p) =>
      `${p.markdown.length} chars, "${p.title ?? "(no title)"}", ${p.creditsUsed ?? "?"} credit(s)`,
    ),
    await timed("paste-a-URL (Firecrawl first)", () => readPage(URL_UNDER_TEST, { prefer: "firecrawl" }), (p) =>
      `via ${p.via}, ${p.text.length} chars`,
    ),
    await timed("refresh job (free fetch first)", () => readPage(URL_UNDER_TEST, { prefer: "direct" }), (p) =>
      `via ${p.via}, ${p.text.length} chars`,
    ),
    await timed(
      "Platina single page",
      () =>
        fetchViaWaters({
          id: "verify",
          workspaceId: "verify",
          status: "approved",
          targets: [{ kind: "competitor_site", value: URL_UNDER_TEST }],
        }),
      (o) =>
        `${o.docs.length} doc(s) via ${o.docs.map((d) => d.adapter).join(", ") || "-"}` +
        (o.fallbacks?.length ? `; fell back: ${o.fallbacks[0].reason}` : "") +
        (o.failures.length ? `; failures: ${o.failures.map((f) => f.error).join("; ")}` : ""),
    ),
  ];
  failures = ok.filter((x) => !x).length;

  console.log(failures === 0 ? "\nAll good.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
