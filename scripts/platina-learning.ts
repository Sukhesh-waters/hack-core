/**
 * Learning engine, from the command line (C8.5): Claude as operator runs the
 * same code as the Learning page.
 *
 *   npm run platina:learning -- --ws waters-gcc-internal --summary
 *   npm run platina:learning -- --ws waters-gcc-internal --triggers
 *   npm run platina:learning -- --ws waters-gcc-internal --ideas [--key <trigger key>]
 *   npm run platina:learning -- --ws waters-gcc-internal --consolidate [--apply]
 *
 * --ideas drafts ideas for one trigger (one model call, daily cap applies) and
 * records them in the ledger. --consolidate is a dry run unless --apply.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  if (!slug) throw new Error("usage: --ws <slug> (--summary | --triggers | --ideas [--key k] | --consolidate [--apply])");
  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);

  if (has("summary")) {
    const { loadLearning, learnedPatterns } = await import("@/lib/platina/learning-engine");
    const { describePublicStat, possessive } = await import("@/lib/platina/learning-public");
    const view = await loadLearning(ws.id);
    const name = view.client?.name ?? "client";
    console.log(`\nLedger: ${view.suggestions.length} suggestions, ${view.events.length} events, ${view.learned.credits.length} credits`);
    const byKind = new Map<string, number>();
    for (const s of view.suggestions) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    console.log(`  by kind: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")}`);
    console.log(`\nPublic lane (${possessive(name)} own posts, min-N ${view.config.minN}):`);
    for (const s of view.publicStats.sort((a, b) => b.n - a.n).slice(0, 12)) console.log(`  ${describePublicStat(s, name, view.config.minN)}`);
    console.log(`\nLedger lane features past min-N: ${view.learned.features.filter((f) => f.status === "ok").length}`);
    console.log(`Trust: ${view.learned.trust.length} sources credited, ${view.learned.trust.filter((t) => t.status === "ok").length} past min-N`);
    console.log(`\nPatterns the idea engine uses:`);
    for (const p of learnedPatterns(view)) console.log(`  ${p.text}`);
  }

  if (has("triggers")) {
    const { loadTriggers } = await import("@/lib/platina/idea-load");
    const { triggers } = await loadTriggers(ws.id);
    console.log(`\nTriggers (${triggers.length}):`);
    for (const t of triggers.slice(0, 12)) console.log(`  [${t.kind}] ${t.title}  (${t.key}, priority ${t.priority.toFixed(2)})`);
  }

  if (has("ideas")) {
    const { runIdeaEngine } = await import("@/lib/platina/idea-run");
    const t0 = Date.now();
    const result = await runIdeaEngine(ws.id, arg("key"), (_id, label, detail) =>
      console.log(`  ✓ ${label} — ${detail} (${((Date.now() - t0) / 1000).toFixed(1)} s)`),
    );
    console.log(`\nIdeas for "${result.trigger.title}":`);
    for (const i of result.ideas) {
      console.log(`\n  ${i.explore ? "[new direction] " : i.pattern ? "[follows pattern] " : ""}${i.title} (${i.channel}, ${i.format})`);
      console.log(`    hook: ${i.hook}`);
      for (const w of i.why) console.log(`    why: ${w.text} [${w.cites.map((c) => c.id).join(",")}]`);
      if (i.fit) console.log(`    fit: ${i.fit.text} [${i.fit.cites.map((c) => c.id).join(",")}]`);
      if (i.pattern) console.log(`    pattern: ${i.pattern.text} [${i.pattern.cites.map((c) => c.id).join(",")}]`);
      console.log(`    ledger: ${i.suggestionId}`);
    }
  }

  if (has("consolidate")) {
    const { runConsolidation } = await import("@/lib/platina/learning-engine");
    const r = await runConsolidation(ws.id, { apply: has("apply") });
    console.log(`\nConsolidation ${r.month}: ${r.applied ? "APPLIED" : r.alreadyDone ? "already done this month" : "dry run"}`);
    for (const l of r.digest.lines) console.log(`  - ${l}`);
    for (const m of r.plan.merges.slice(0, 8)) {
      console.log(`\n  keep: ${m.keep.slice(0, 140)}`);
      for (const a of m.absorbed) console.log(`   + merge: ${a.slice(0, 140)}`);
    }
    for (const x of r.plan.retire) console.log(`  retire: ${x.content.slice(0, 120)} (${x.why})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

export {};
