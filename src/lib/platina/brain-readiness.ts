/**
 * Is the database ready for the Brain work? (metacognitive Brain, showcase
 * readiness). Pure: the script feeds it what information_schema reports and
 * it says which migration is missing what. The live job writes these columns,
 * so new code must never run against a database that lacks them (plan §11.6).
 */

export type SchemaObject = { table: string; column?: string };

/** What each Brain migration adds, as information_schema will report it. */
export const BRAIN_MIGRATIONS: { id: string; slice: string; objects: SchemaObject[] }[] = [
  {
    id: "0087",
    slice: "B0 modes, telemetry, undo journal",
    objects: [
      { table: "platina_brain_telemetry" },
      { table: "platina_brain_state_log" },
      { table: "platina_workspace_config", column: "brain_modes" },
      { table: "platina_workspace_config", column: "surprise_floor" },
      { table: "platina_workspace_config", column: "derived_context_share" },
      { table: "platina_debate_transcripts", column: "prompt_version" },
      { table: "platina_debate_transcripts", column: "blinded" },
      { table: "platina_signal_documents", column: "skip_cause" },
    ],
  },
  {
    id: "0088",
    slice: "B1 testable claims",
    objects: [
      { table: "platina_brain_chunks", column: "kind" },
      { table: "platina_brain_chunks", column: "falsifier" },
      { table: "platina_brain_chunks", column: "grade_state" },
      { table: "platina_brain_chunks", column: "due_at" },
      { table: "platina_brain_chunks", column: "written_by" },
    ],
  },
  {
    id: "0089",
    slice: "B5 grades",
    objects: [{ table: "platina_insight_grades" }, { table: "platina_brain_chunks", column: "refuted_by_grade_id" }],
  },
  {
    id: "0090",
    slice: "B4 expectations",
    objects: [{ table: "platina_expectations" }],
  },
];

export type MigrationCheck = { id: string; slice: string; ok: boolean; missing: string[] };

const label = (o: SchemaObject) => (o.column ? `${o.table}.${o.column}` : o.table);

/** `present` holds "table" and "table.column" strings from information_schema. */
export function checkBrainMigrations(present: Set<string>): MigrationCheck[] {
  return BRAIN_MIGRATIONS.map((m) => {
    const missing = m.objects.map(label).filter((name) => !present.has(name));
    return { id: m.id, slice: m.slice, ok: missing.length === 0, missing };
  });
}

/** One line per migration for the terminal. */
export function describeChecks(checks: MigrationCheck[]): string[] {
  return checks.map((c) =>
    c.ok ? `OK       ${c.id}  ${c.slice}` : `MISSING  ${c.id}  ${c.slice}: ${c.missing.join(", ")}`,
  );
}
