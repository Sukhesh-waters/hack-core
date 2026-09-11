import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  platinaBrandChunks,
  platinaBrainChunks,
  platinaSignalDocuments,
} from "./platina-schema";

/**
 * Modelled on layer-separation.integration.test.ts: the invariant is
 * structural. Plane B cannot be retrieved as a vector because the column
 * does not exist.
 */
describe("platina three-plane separation", () => {
  it("plane B has no embedding column so it cannot reach a citation", () => {
    expect(getTableColumns(platinaSignalDocuments).embedding).toBeUndefined();
  });

  it("plane A and plane C are the only embedded stores", () => {
    expect(getTableColumns(platinaBrandChunks).embedding).toBeDefined();
    expect(getTableColumns(platinaBrainChunks).embedding).toBeDefined();
  });

  it("plane C carries a generation counter so compacted chunks stay attributable", () => {
    expect(getTableColumns(platinaBrainChunks).generation).toBeDefined();
    expect(getTableColumns(platinaBrainChunks).absorbedChunkIds).toBeDefined();
  });
});
