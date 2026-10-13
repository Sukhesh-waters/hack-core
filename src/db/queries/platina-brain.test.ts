import { describe, expect, it } from "vitest";
import {
  brainChunkStateQuery,
  brainFunnelCountsQuery,
  brainStateLogQuery,
  brainTelemetryQuery,
  pruneBrainTelemetryQuery,
  updateBrainChunkStateQuery,
} from "./platina-brain";

describe("B0 brain queries filter workspace_id in the generated SQL", () => {
  it("brainTelemetryQuery: workspace always filtered; stage and since are optional", () => {
    const base = brainTelemetryQuery("ws_a").toSQL();
    expect(base.sql).toContain('"platina_brain_telemetry"."workspace_id" = ');
    expect(base.params).toContain("ws_a");
    expect(base.sql).not.toContain('"platina_brain_telemetry"."stage" = ');

    const filtered = brainTelemetryQuery("ws_a", { stage: "analysis", since: new Date("2026-01-01") }).toSQL();
    expect(filtered.sql).toContain('"platina_brain_telemetry"."stage" = ');
    expect(filtered.sql).toContain('"platina_brain_telemetry"."created_at" >= ');
    expect(filtered.params).toEqual(expect.arrayContaining(["ws_a", "analysis"]));
  });

  it("brainFunnelCountsQuery groups by stage and decision, filtered to workspace and since", () => {
    const { sql, params } = brainFunnelCountsQuery("ws_a", new Date("2026-01-01")).toSQL();
    expect(sql).toContain('"platina_brain_telemetry"."workspace_id" = ');
    expect(sql).toMatch(/group by/i);
    expect(sql).toContain('"platina_brain_telemetry"."stage"');
    expect(sql).toContain('"platina_brain_telemetry"."decision"');
    expect(params).toContain("ws_a");
  });

  it("pruneBrainTelemetryQuery deletes only this workspace's old rows", () => {
    const { sql, params } = pruneBrainTelemetryQuery("ws_a", new Date("2026-01-01")).toSQL();
    expect(sql).toMatch(/delete from/i);
    expect(sql).toContain('"platina_brain_telemetry"."workspace_id" = ');
    expect(sql).toContain('"platina_brain_telemetry"."created_at" < ');
    expect(params).toContain("ws_a");
  });

  it("brainStateLogQuery: workspace always filtered; cause, since, chunkIds are optional", () => {
    const base = brainStateLogQuery("ws_a").toSQL();
    expect(base.sql).toContain('"platina_brain_state_log"."workspace_id" = ');
    expect(base.params).toContain("ws_a");

    const filtered = brainStateLogQuery("ws_a", {
      cause: "grading",
      since: new Date("2026-01-01"),
      chunkIds: ["c1", "c2"],
    }).toSQL();
    expect(filtered.sql).toContain('"platina_brain_state_log"."cause" = ');
    expect(filtered.sql).toContain('"platina_brain_state_log"."created_at" >= ');
    expect(filtered.sql).toContain('"platina_brain_state_log"."brain_chunk_id" in');
    expect(filtered.params).toEqual(expect.arrayContaining(["ws_a", "grading", "c1", "c2"]));
  });

  it("brainChunkStateQuery (setBrainState's select) filters workspace AND chunk id, and locks the row", () => {
    const { sql, params } = brainChunkStateQuery("ws_a", "chunk1").toSQL();
    expect(sql).toContain('"platina_brain_chunks"."workspace_id" = ');
    expect(sql).toContain('"platina_brain_chunks"."id" = ');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "chunk1"]));
    // A concurrent grader/undo/restore must block on this row, not diff a
    // stale read (see the file-header comment on setBrainState).
    expect(sql.toLowerCase()).toContain("for update");
  });

  it("updateBrainChunkStateQuery (setBrainState's write) filters workspace AND chunk id", () => {
    const { sql, params } = updateBrainChunkStateQuery("ws_a", "chunk1", { confidence: 0.6 }).toSQL();
    expect(sql).toMatch(/^update/i);
    expect(sql).toContain('"workspace_id" = ');
    expect(sql).toContain('"id" = ');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "chunk1", 0.6]));
  });
});
