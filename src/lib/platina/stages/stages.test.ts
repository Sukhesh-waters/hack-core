import { describe, expect, it, vi } from "vitest";
import { parseCited } from "./cited";
import { buildDivergencePrompt, runDivergenceStage, type DivergenceDeps } from "./divergence";
import { MIN_IDEATION_EVIDENCE, runIdeationStage, type IdeationDeps } from "./ideation";

const brand = [{ id: "b1", content: "We speak plainly and never overpromise." }];
const rivals = [
  { id: "c1", content: "Rival A leads with bold guarantees." },
  { id: "c2", content: "Rival B promises instant results." },
  { id: "c3", content: "Rival C runs a giveaway." },
];

const reply = (items: unknown[]) => JSON.stringify({ items });
const item = (over: Record<string, unknown> = {}) => ({
  title: "Rivals lean on guarantees",
  summary: "Competitors promise outcomes; our standard avoids that.",
  severity: "medium",
  brandChunkIds: ["b1"],
  brainChunkIds: ["c1"],
  ...over,
});

describe("parseCited", () => {
  const rule = { brand: new Set(["b1"]), brain: new Set(["c1", "c2"]), require: { brand: true, brain: true } };

  it("keeps items whose ids all exist in the right lists", () => {
    expect(parseCited(reply([item()]), rule)).toMatchObject({ rejected: 0, items: [{ title: item().title }] });
  });

  it("rejects an item with an invented id", () => {
    expect(parseCited(reply([item({ brainChunkIds: ["ghost"] })]), rule)).toMatchObject({ items: [], rejected: 1 });
  });

  it("rejects an item that cites nothing where a list is required", () => {
    expect(parseCited(reply([item({ brandChunkIds: [] })]), rule).rejected).toBe(1);
  });

  it("does not accept a brain id in the brand list (planes stay separate)", () => {
    expect(parseCited(reply([item({ brandChunkIds: ["c1"] })]), rule).rejected).toBe(1);
  });

  it("throws on non-JSON so the stage degrades instead of storing nothing", () => {
    expect(() => parseCited("not json", rule)).toThrow(/expected JSON/);
  });
});

function divergenceDeps(over: Partial<DivergenceDeps> = {}): DivergenceDeps & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    loadBrand: async () => brand,
    loadCompetitor: async () => rivals,
    propose: async () => reply([item()]),
    exists: async () => false,
    insertFinding: async (input) => {
      inserted.push(input);
      return "f1";
    },
    ...over,
    inserted,
  };
}

describe("runDivergenceStage", () => {
  it("skips with a stated reason when there is no brand standard", async () => {
    const deps = divergenceDeps({ loadBrand: async () => [] });
    expect(await runDivergenceStage(deps, "ws")).toEqual({
      status: "skipped",
      reason:
        "no declared brand standard yet — confirm a client profile to turn this on",
    });
  });

  it("skips when there is no competitor evidence, without calling the model", async () => {
    const propose = vi.fn();
    const deps = divergenceDeps({ loadCompetitor: async () => [], propose });
    expect((await runDivergenceStage(deps, "ws")).status).toBe("skipped");
    expect(propose).not.toHaveBeenCalled();
  });

  it("stores a cited finding with the two evidence lists kept apart", async () => {
    const deps = divergenceDeps();
    const result = await runDivergenceStage(deps, "ws");
    expect(result).toMatchObject({ status: "done", produced: 1 });
    expect(deps.inserted[0]).toMatchObject({
      useCase: "brand_divergence",
      evidence: { brandChunkIds: ["b1"], brainChunkIds: ["c1"] },
    });
  });

  it("degrades (throws) when every item is uncited, and stores nothing", async () => {
    const deps = divergenceDeps({ propose: async () => reply([item({ brandChunkIds: [] })]) });
    await expect(runDivergenceStage(deps, "ws")).rejects.toThrow(/uncited/);
    expect(deps.inserted).toEqual([]);
  });

  it("an empty items array is a legitimate 'nothing diverges', not an error", async () => {
    const deps = divergenceDeps({ propose: async () => reply([]) });
    expect(await runDivergenceStage(deps, "ws")).toMatchObject({ status: "done", produced: 0 });
  });

  it("does not repeat a finding that is already open", async () => {
    const deps = divergenceDeps({ exists: async () => true });
    expect(await runDivergenceStage(deps, "ws")).toMatchObject({ produced: 0 });
    expect(deps.inserted).toEqual([]);
  });

  it("shows the model both planes as separate labelled lists", () => {
    const prompt = buildDivergencePrompt(brand, rivals);
    const [brandBlock, rivalBlock] = prompt.split("\n\n");
    expect(brandBlock).toContain("[b1]");
    expect(brandBlock).not.toContain("[c1]");
    expect(rivalBlock).toContain("[c1]");
    expect(rivalBlock).not.toContain("[b1]");
  });
});

function ideationDeps(over: Partial<IdeationDeps> = {}): IdeationDeps & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    loadBrain: async () => rivals,
    propose: async () => reply([{ title: "Lead with proof", summary: "Patterns favour proof over promises.", severity: "low", brainChunkIds: ["c1", "c2"] }]),
    exists: async () => false,
    insertFinding: async (input) => {
      inserted.push(input);
      return "f2";
    },
    ...over,
    inserted,
  };
}

describe("runIdeationStage", () => {
  it("refuses to invent a direction below the evidence floor", async () => {
    const propose = vi.fn();
    const deps = ideationDeps({ loadBrain: async () => rivals.slice(0, MIN_IDEATION_EVIDENCE - 1), propose });
    const result = await runIdeationStage(deps, "ws");
    expect(result).toMatchObject({ status: "skipped" });
    expect(propose).not.toHaveBeenCalled();
  });

  it("cites Brain chunks only — never first-party ids", async () => {
    const deps = ideationDeps();
    await runIdeationStage(deps, "ws");
    expect(deps.inserted[0]).toMatchObject({
      useCase: "ideation",
      evidence: { brandChunkIds: [], brainChunkIds: ["c1", "c2"] },
    });
  });

  it("rejects a direction that cites an unknown id", async () => {
    const deps = ideationDeps({
      propose: async () => reply([{ title: "Made up", summary: "Cites nothing real here.", brainChunkIds: ["nope"] }]),
    });
    await expect(runIdeationStage(deps, "ws")).rejects.toThrow(/uncited|unknown/);
  });
});

describe("R3 — the skip reason tells the operator what to do", () => {
  it("names the client whose profile needs confirming", async () => {
    const deps = divergenceDeps({
      loadBrand: async () => [],
      clientName: "Northwind Coffee",
    });
    expect(await runDivergenceStage(deps, "ws")).toEqual({
      status: "skipped",
      reason: "confirm how we describe Northwind Coffee to turn this on",
    });
  });
});
