import { describe, expect, it } from "vitest";
import {
  EVIDENCE_STALE_DAYS,
  findCitationProblem,
  isStale,
  renderEvidenceBlock,
  snapshotEvidence,
  type PlanEvidence,
} from "./evidence";

const NOW = new Date("2026-09-20T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const B1: PlanEvidence = {
  id: "b1",
  plane: "B",
  content: "Rivals push instant results.",
  sourceUrl: "https://rival.com/news",
  collectedAt: daysAgo(2),
  confidence: 0.8,
};
const A1: PlanEvidence = { ...B1, id: "a1", plane: "A", content: "Our best channel is email.", sourceUrl: null };

describe("isStale", () => {
  it("flags evidence older than the threshold and keeps fresh evidence", () => {
    expect(isStale(daysAgo(EVIDENCE_STALE_DAYS + 1), NOW)).toBe(true);
    expect(isStale(daysAgo(EVIDENCE_STALE_DAYS - 1), NOW)).toBe(false);
  });

  it("does not call an unknown date stale", () => {
    expect(isStale(null, NOW)).toBe(false);
    expect(isStale("not a date", NOW)).toBe(false);
  });

  it("accepts the ISO strings a stored snapshot carries", () => {
    expect(isStale(daysAgo(90).toISOString(), NOW)).toBe(true);
  });
});

describe("renderEvidenceBlock / snapshotEvidence", () => {
  it("shows ids verbatim with the collection date and source", () => {
    const block = renderEvidenceBlock("Public", [B1]);
    expect(block).toContain("[b1]");
    expect(block).toContain("collected 2026-09-18");
    expect(block).toContain("https://rival.com/news");
  });

  it("says 'none' for an empty list rather than omitting the block", () => {
    expect(renderEvidenceBlock("Public", [])).toBe("Public: none.");
  });

  it("says the date is unknown instead of inventing one", () => {
    expect(renderEvidenceBlock("Public", [{ ...B1, collectedAt: null }])).toContain("date unknown");
  });

  it("freezes evidence for storage with ISO dates", () => {
    expect(snapshotEvidence([B1])[0]).toMatchObject({ id: "b1", collectedAt: daysAgo(2).toISOString() });
  });
});

describe("findCitationProblem", () => {
  const phase = (evidenceIds?: string[]) => ({ name: "Launch", evidenceIds });

  it("accepts a clean plan and a phase that cites nothing", () => {
    expect(findCitationProblem([phase(["b1"]), phase()], [B1, A1])).toBeNull();
  });

  it("rejects an id the planner was never shown", () => {
    expect(findCitationProblem([phase(["ghost"])], [B1])).toMatch(/not provided/);
  });

  it("rejects a phase that mixes first-party and public evidence", () => {
    expect(findCitationProblem([phase(["a1", "b1"])], [B1, A1])).toMatch(/one only/);
  });

  it("allows different phases to cite different planes", () => {
    expect(findCitationProblem([phase(["a1"]), phase(["b1"])], [B1, A1])).toBeNull();
  });
});
