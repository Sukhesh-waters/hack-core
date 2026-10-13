import { describe, expect, it } from "vitest";
import { brainQualityTranscriptsQuery, fetchedDocumentCountQuery } from "./platina-brain-quality";

describe("B0 brain-quality queries filter workspace_id in the generated SQL", () => {
  it("brainQualityTranscriptsQuery filters workspace and since, selects the tracking columns", () => {
    const { sql, params } = brainQualityTranscriptsQuery("ws_a", new Date("2026-01-01")).toSQL();
    expect(sql).toContain('"platina_debate_transcripts"."workspace_id" = ');
    expect(sql).toContain('"platina_debate_transcripts"."created_at" >= ');
    expect(sql).toContain('"prompt_version"');
    expect(sql).toContain('"proposer_model"');
    expect(sql).toContain('"objected"');
    expect(sql).toContain('"state"');
    expect(params).toContain("ws_a");
  });

  it("fetchedDocumentCountQuery counts platina_signal_documents filtered to workspace and since", () => {
    const { sql, params } = fetchedDocumentCountQuery("ws_a", new Date("2026-01-01")).toSQL();
    expect(sql).toContain('"platina_signal_documents"."workspace_id" = ');
    expect(sql).toContain('"platina_signal_documents"."fetched_at" >= ');
    expect(sql).toMatch(/count\(\*\)/i);
    expect(params).toContain("ws_a");
  });
});
