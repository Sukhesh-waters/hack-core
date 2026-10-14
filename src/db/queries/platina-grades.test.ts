import { describe, expect, it } from "vitest";
import {
  dueFalsifierChunksQuery,
  gradeCountsForChunkQuery,
  gradeCountsQuery,
  refutedChunksBySubjectQuery,
} from "./platina-grades";

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
});
