import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/queries/platina-brain", () => ({
  brainFunnelCounts: vi.fn().mockRejectedValue(new Error('relation "platina_brain_telemetry" does not exist')),
  getBrainModes: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/db/queries/platina-brain-quality", () => ({
  fetchedDocumentCount: vi.fn().mockResolvedValue(0),
  listBrainQualityTranscripts: vi.fn().mockResolvedValue([]),
}));

import { BRAIN_QUALITY_UNAVAILABLE, loadBrainQualityCard } from "./brain-quality-loader";

describe("loadBrainQualityCard", () => {
  it("costs one card, not the Health page, when its tables cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadBrainQualityCard("ws_a")).resolves.toEqual([BRAIN_QUALITY_UNAVAILABLE]);
    warn.mockRestore();
  });
});
