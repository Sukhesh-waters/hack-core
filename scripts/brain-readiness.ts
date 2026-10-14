/**
 * Is the database ready for the Brain work, and what is each workspace's
 * Brain doing? Read-only: information_schema plus workspace-filtered counts.
 *
 *   npm run platina:brain-readiness              (schema check + every workspace)
 *   npm run platina:brain-readiness -- --ws waters-gcc-internal
 *
 * Exit 1 when any Brain migration is missing: start `npm run dev:all` only
 * after this passes, because the live analysis job writes these columns.
 */
async function main() {
  process.loadEnvFile(".env.local");
  const wsIndex = process.argv.indexOf("--ws");
  const onlySlug = wsIndex >= 0 ? process.argv[wsIndex + 1] : null;

  const { default: postgres } = await import("postgres");
  const { checkBrainMigrations, describeChecks } = await import("@/lib/platina/brain-readiness");
  const { parseBrainModes } = await import("@/lib/platina/brain-modes");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public' and table_name like 'platina_%'`;
    const columns = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name like 'platina_%'`;
    const present = new Set([
      ...tables.map((t) => t.table_name),
      ...columns.map((c) => `${c.table_name}.${c.column_name}`),
    ]);
    const checks = checkBrainMigrations(present);
    console.log("Brain migrations\n");
    for (const line of describeChecks(checks)) console.log(`  ${line}`);
    const ready = checks.every((c) => c.ok);
    if (!ready) {
      console.log("\nNot ready: run `npm run db:migrate` before starting `npm run dev:all`.");
      process.exitCode = 1;
      return;
    }

    const workspaces = onlySlug
      ? await sql<{ id: string; slug: string }[]>`select id, slug from workspaces where slug = ${onlySlug}`
      : await sql<{ id: string; slug: string }[]>`
          select w.id, w.slug from workspaces w
          where exists (select 1 from platina_brain_chunks b where b.workspace_id = w.id)
             or exists (select 1 from platina_workspace_config c where c.workspace_id = w.id)
          order by w.slug`;
    if (onlySlug && workspaces.length === 0) throw new Error(`no workspace "${onlySlug}"`);

    for (const ws of workspaces) {
      const [config] = await sql<{ brain_modes: unknown }[]>`
        select brain_modes from platina_workspace_config where workspace_id = ${ws.id}`;
      const modes = parseBrainModes(config?.brain_modes ?? {});
      const chunks = await sql<{ grade_state: string; status: string; n: number }[]>`
        select grade_state, status, count(*)::int as n from platina_brain_chunks
        where workspace_id = ${ws.id} group by grade_state, status order by n desc`;
      const telemetry = await sql<{ stage: string; decision: string; n: number }[]>`
        select stage, decision, count(*)::int as n from platina_brain_telemetry
        where workspace_id = ${ws.id} and created_at > now() - interval '7 days'
        group by stage, decision order by stage, n desc`;
      const grades = await sql<{ verdict: string; n: number }[]>`
        select verdict, count(*)::int as n from platina_insight_grades
        where workspace_id = ${ws.id} group by verdict order by n desc`;

      console.log(`\n${ws.slug}`);
      console.log(`  stages:    ${Object.entries(modes).map(([s, m]) => `${s}=${m}`).join("  ")}`);
      console.log(`  brain:     ${chunks.map((c) => `${c.status}/${c.grade_state} ${c.n}`).join(", ") || "empty"}`);
      console.log(`  last 7 d:  ${telemetry.map((t) => `${t.stage}.${t.decision} ${t.n}`).join(", ") || "no telemetry yet"}`);
      console.log(`  grades:    ${grades.map((g) => `${g.verdict} ${g.n}`).join(", ") || "none yet"}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
