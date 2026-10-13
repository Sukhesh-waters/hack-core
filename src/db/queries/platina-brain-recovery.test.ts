import { describe, expect, it } from "vitest";
import { brainChunkStatesQuery, resetSkippedSignalsQuery, skippedSignalsQuery } from "./platina-brain-recovery";

describe("B0 recovery queries filter workspace_id in the generated SQL", () => {
  it("brainChunkStatesQuery", () => {
    const { sql, params } = brainChunkStatesQuery("ws_a").toSQL();
    expect(sql).toContain('"platina_brain_chunks"."workspace_id" = ');
    expect(params).toEqual(["ws_a"]);
  });

  it("skippedSignalsQuery filters workspace, terminal state, skip cause, and since", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const { sql, params } = skippedSignalsQuery("ws_a", "surprise", since).toSQL();
    expect(sql).toContain('"platina_signal_documents"."workspace_id" = ');
    expect(sql).toContain('"platina_signal_documents"."processing_state" = ');
    expect(sql).toContain('"platina_signal_documents"."skip_cause" = ');
    expect(sql).toContain('"platina_signal_documents"."fetched_at" >= ');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "processed", "surprise", since.toISOString()]));
  });

  it("resetSkippedSignalsQuery is workspace-filtered AND id-list-bound, never a blanket update", () => {
    const { sql, params } = resetSkippedSignalsQuery("ws_a", ["d1", "d2"]).toSQL();
    expect(sql).toMatch(/^update/i);
    expect(sql).toContain('"platina_signal_documents"."workspace_id" = ');
    expect(sql).toContain('"platina_signal_documents"."id" in');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "d1", "d2"]));
  });
});
