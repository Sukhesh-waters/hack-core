import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  advanceDueAtQuery,
  dueFalsifierChunksQuery,
  gradeCountsForChunkQuery,
  citedEvidenceVerdictsQuery,
  gradeCountsQuery,
  refutedChunksBySubjectQuery,
  similarRefutedBrainChunksQuery,
} from "./platina-grades";

describe("W3b/B8 queries filter workspace_id in the generated SQL", () => {
  it("similarRefutedBrainChunksQuery: workspace, demoted + refuted only, current embedding version", () => {
    const { sql, params } = similarRefutedBrainChunksQuery("ws_a", [0.1, 0.2, 0.3], 10).toSQL();
    expect(sql).toContain('"platina_brain_chunks"."workspace_id" = ');
    expect(sql).toContain('"platina_brain_chunks"."status" = ');
    expect(sql).toContain('"platina_brain_chunks"."grade_state" = ');
    expect(sql).toContain('"platina_brain_chunks"."embedding_model_version" = ');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "demoted", "refuted"]));
  });

  it("citedEvidenceVerdictsQuery: workspace on both tables, id-bound, refuted/promoted only", () => {
    const { sql, params } = citedEvidenceVerdictsQuery("ws_a", ["c1", "c2"]).toSQL();
    expect(sql).toContain('"platina_brain_chunks"."workspace_id" = ');
    expect(sql).toContain('"platina_insight_grades"."workspace_id" = ');
    expect(sql).toContain('"platina_brain_chunks"."grade_state" in');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "c1", "c2", "refuted", "promoted"]));
  });
});

describe("B5 grade queries filter workspace_id in the generated SQL", () => {
  it("dueFalsifierChunksQuery: workspace filtered, kind/falsifier/gradeState/dueAt/status all present", () => {
    const now = new Date("2026-11-20T05:00:00Z");
    const { sql, params } = dueFalsifierChunksQuery("ws_a", now).toSQL();
    expect(sql).toContain('"platina_brain_chunks"."workspace_id" = ');
    expect(sql).toContain('"platina_brain_chunks"."kind" in');
    expect(sql).toMatch(/"falsifier" is not null/);
    expect(sql).toContain('"platina_brain_chunks"."grade_state" in');
    expect(sql).toContain('"platina_brain_chunks"."due_at" <= ');
    expect(sql).toContain('"platina_brain_chunks"."status" = ');
    expect(params).toEqual(
      expect.arrayContaining(["ws_a", "claim", "measured", "untested", "holding", now.toISOString(), "active"]),
    );
    expect(sql.toLowerCase()).toContain("limit");
  });

  it("dueFalsifierChunksQuery: afterId adds an id cursor and a custom limit is honoured", () => {
    const now = new Date("2026-11-20T05:00:00Z");
    const { sql, params } = dueFalsifierChunksQuery("ws_a", now, { afterId: "chunk5", limit: 50 }).toSQL();
    expect(sql).toContain('"platina_brain_chunks"."id" > ');
    expect(params).toEqual(expect.arrayContaining(["chunk5", 50]));
  });

  it("dueFalsifierChunksQuery: never selects grade_state=insufficient (never re-tested) or facts (kind excluded)", () => {
    const { params } = dueFalsifierChunksQuery("ws_a", new Date()).toSQL();
    expect(params).not.toContain("insufficient");
    expect(params).not.toContain("fact");
  });

  it("refutedChunksBySubjectQuery filters workspace, subject, status=demoted, grade_state=refuted", () => {
    const { sql, params } = refutedChunksBySubjectQuery("ws_a", "brand:acme|topic:pfas").toSQL();
    expect(sql).toContain('"platina_brain_chunks"."workspace_id" = ');
    expect(sql).toContain('"platina_brain_chunks"."subject_key" = ');
    expect(sql).toContain('"platina_brain_chunks"."status" = ');
    expect(sql).toContain('"platina_brain_chunks"."grade_state" = ');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "brand:acme|topic:pfas", "demoted", "refuted"]));
  });

  it("gradeCountsQuery groups by verdict, filtered to workspace", () => {
    const { sql, params } = gradeCountsQuery("ws_a").toSQL();
    expect(sql).toContain('"platina_insight_grades"."workspace_id" = ');
    expect(sql).toMatch(/group by/i);
    expect(sql).toContain('"platina_insight_grades"."verdict"');
    expect(params).toContain("ws_a");
  });

  it("gradeCountsForChunkQuery filters workspace AND brain_chunk_id, grouped by verdict", () => {
    const { sql, params } = gradeCountsForChunkQuery("ws_a", "chunk1").toSQL();
    expect(sql).toContain('"platina_insight_grades"."workspace_id" = ');
    expect(sql).toContain('"platina_insight_grades"."brain_chunk_id" = ');
    expect(sql).toMatch(/group by/i);
    expect(params).toEqual(expect.arrayContaining(["ws_a", "chunk1"]));
  });

  it("advanceDueAtQuery is an UPDATE guarded on workspace, id, AND the chunk's current due_at (idempotent re-advance guard)", () => {
    const from = new Date("2026-11-20T00:00:00Z");
    const to = new Date("2026-12-20T00:00:00Z");
    const { sql, params } = advanceDueAtQuery("ws_a", "chunk1", from, to).toSQL();
    expect(sql).toMatch(/^update/i);
    expect(sql).toContain('"platina_brain_chunks"."workspace_id" = ');
    expect(sql).toContain('"platina_brain_chunks"."id" = ');
    expect(sql).toContain('"platina_brain_chunks"."due_at" = ');
    expect(sql).toContain('"due_at" = ');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "chunk1", from.toISOString(), to.toISOString()]));
  });
});

describe("B5 shadow idempotency and the re-test unique key (migration 0089)", () => {
  // The unique index is what actually makes "holding is re-graded on the
  // next due date" and "shadow writes one row per due date" true at the DB
  // level — proven here against the generated migration SQL itself (the
  // same kind of textual proof migrations-down.test.ts already uses), not
  // guessed at from the schema file alone.
  function readUpMigration(tag: string): string {
    const dir = join(__dirname, "..", "..", "..", "drizzle");
    const file = readdirSync(dir).find((f) => f.startsWith(tag) && f.endsWith(".sql"));
    if (!file) throw new Error(`no migration file starting with "${tag}" in ${dir}`);
    return readFileSync(join(dir, file), "utf-8");
  }

  it("platina_insight_grades.due_at is NOT NULL (every grade row freezes the due date it tested)", () => {
    const sql = readUpMigration("0089");
    expect(sql).toMatch(/"due_at" timestamp NOT NULL/);
  });

  it("the unique index is (brain_chunk_id, metric, window_days, due_at) — due_at included, not (chunk, window, metric) alone", () => {
    const sql = readUpMigration("0089");
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "platina_insight_grades_once_unique" ON "platina_insight_grades" USING btree \("brain_chunk_id","metric","window_days","due_at"\)/,
    );
  });
});
