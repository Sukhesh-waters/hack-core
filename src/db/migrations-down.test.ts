/**
 * Proves a hand-written down migration actually reverses its up migration
 * (B0 — metacognitive Brain, plan §4, §11.1 L4). Static/textual on purpose:
 * every table CREATEd and every column ADDed in an up migration must have a
 * matching DROP in drizzle/down/<NN>.sql. This runs in CI on every slice; a
 * real up->down->up apply against a test database is an operator step
 * (plan §11.5), not this test.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DRIZZLE_DIR = join(__dirname, "..", "..", "drizzle");
const DOWN_DIR = join(DRIZZLE_DIR, "down");

const CREATE_TABLE_RE = /CREATE TABLE "([^"]+)"/g;
const ADD_COLUMN_RE = /ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/g;
const DROP_TABLE_RE = /DROP TABLE IF EXISTS "([^"]+)"/g;
const DROP_COLUMN_RE = /ALTER TABLE "([^"]+)" DROP COLUMN IF EXISTS "([^"]+)"/g;

function matchesOf(text: string, re: RegExp): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(re)) out.push(m.slice(1));
  return out;
}

/** Every up migration that has a hand-written down file, found by number prefix. */
function downMigrationPairs(): { upFile: string; downFile: string; tag: string }[] {
  let downFiles: string[] = [];
  try {
    downFiles = readdirSync(DOWN_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    return []; // no drizzle/down directory yet
  }
  const upFiles = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql"));
  return downFiles.map((downFile) => {
    const tag = downFile.replace(/\.sql$/, ""); // e.g. "0087"
    const upFile = upFiles.find((f) => f.startsWith(tag));
    if (!upFile) {
      throw new Error(`drizzle/down/${downFile} has no matching up migration starting with "${tag}"`);
    }
    return { upFile, downFile, tag };
  });
}

describe("every hand-written down migration reverses its up migration", () => {
  const pairs = downMigrationPairs();

  it("at least one down migration exists (B0 ships 0087)", () => {
    expect(pairs.length).toBeGreaterThan(0);
  });

  it.each(pairs.map((p) => [p.tag, p] as const))("%s: every CREATEd table is DROPped", (_tag, { upFile, downFile }) => {
    const up = readFileSync(join(DRIZZLE_DIR, upFile), "utf-8");
    const down = readFileSync(join(DOWN_DIR, downFile), "utf-8");
    const createdTables = matchesOf(up, CREATE_TABLE_RE).map(([table]) => table);
    const droppedTables = new Set(matchesOf(down, DROP_TABLE_RE).map(([table]) => table));
    for (const table of createdTables) {
      expect(droppedTables.has(table), `${downFile} does not drop table "${table}"`).toBe(true);
    }
  });

  it.each(pairs.map((p) => [p.tag, p] as const))("%s: every ADDed column is DROPped", (_tag, { upFile, downFile }) => {
    const up = readFileSync(join(DRIZZLE_DIR, upFile), "utf-8");
    const down = readFileSync(join(DOWN_DIR, downFile), "utf-8");
    const addedColumns = matchesOf(up, ADD_COLUMN_RE); // [table, column][]
    const droppedColumns = new Set(matchesOf(down, DROP_COLUMN_RE).map(([table, col]) => `${table}.${col}`));
    for (const [table, column] of addedColumns) {
      expect(
        droppedColumns.has(`${table}.${column}`),
        `${downFile} does not drop column "${table}.${column}"`,
      ).toBe(true);
    }
  });

  it.each(pairs.map((p) => [p.tag, p] as const))("%s: the down file adds/creates nothing (additive-only reversal)", (_tag, { downFile }) => {
    const down = readFileSync(join(DOWN_DIR, downFile), "utf-8");
    expect(down).not.toMatch(/\bCREATE TABLE\b/i);
    expect(down).not.toMatch(/\bADD COLUMN\b/i);
  });
});

describe("0087 specifically (B0 — metacognitive Brain)", () => {
  it("drops exactly the two new tables and the columns this slice added", () => {
    const down = readFileSync(join(DOWN_DIR, "0087.sql"), "utf-8");
    const droppedTables = new Set(matchesOf(down, DROP_TABLE_RE).map(([table]) => table));
    expect(droppedTables).toEqual(new Set(["platina_brain_state_log", "platina_brain_telemetry"]));

    const droppedColumns = matchesOf(down, DROP_COLUMN_RE).map(([table, col]) => `${table}.${col}`);
    expect(droppedColumns.sort()).toEqual(
      [
        "platina_debate_transcripts.proposer_provider",
        "platina_debate_transcripts.proposer_model",
        "platina_debate_transcripts.challenger_provider",
        "platina_debate_transcripts.challenger_model",
        "platina_debate_transcripts.prompt_version",
        "platina_debate_transcripts.blinded",
        "platina_debate_transcripts.objected",
        "platina_signal_documents.skip_cause",
        "platina_workspace_config.brain_modes",
        "platina_workspace_config.surprise_floor",
        "platina_workspace_config.surprise_audit_share",
        "platina_workspace_config.derived_context_share",
      ].sort(),
    );
  });
});
