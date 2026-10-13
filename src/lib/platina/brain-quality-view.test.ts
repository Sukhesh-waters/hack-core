import { describe, expect, it } from "vitest";
import { BRAIN_STAGES, type BrainMode, type BrainStage } from "./brain-modes";
import { buildBrainQualityCard, type BrainQualityTranscriptRow } from "./brain-quality-view";
import { OBJECTION_MIN_ROUNDS } from "./objection-rate";

const ALL_OFF: Record<BrainStage, BrainMode> = Object.fromEntries(
  BRAIN_STAGES.map((s) => [s, "off"]),
) as Record<BrainStage, BrainMode>;

const round = (
  promptVersion: string | null,
  proposerModel: string | null,
  state: BrainQualityTranscriptRow["state"],
): BrainQualityTranscriptRow => ({
  promptVersion,
  proposerModel,
  objected: state === "contested" || state === "refuted",
  state,
});

describe("buildBrainQualityCard — documents read by a model", () => {
  it("reports the share and stopped counts in plain words", () => {
    const rows = buildBrainQualityCard({
      funnel: [
        { stage: "analysis", decision: "analysed", count: 6 },
        { stage: "analysis", decision: "low_value", count: 2 },
        { stage: "analysis", decision: "nothing_new", count: 1 },
        { stage: "analysis", decision: "own_brand", count: 1 },
      ],
      fetchedCount: 10,
      transcripts: [],
      modes: ALL_OFF,
    });
    const docs = rows.find((r) => r.label === "Documents read by a model")!;
    expect(docs.value).toBeCloseTo(0.6);
    expect(docs.status).toBe("ok");
    expect(docs.detail).toContain("Low-value page");
    expect(docs.detail).toContain("Read, nothing new");
    expect(docs.detail).toContain("Client's own page");
  });

  it("is not_enough with no fetched count — never a synthesised share", () => {
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: [], modes: ALL_OFF });
    const docs = rows.find((r) => r.label === "Documents read by a model")!;
    expect(docs.value).toBeNull();
    expect(docs.status).toBe("not_enough");
  });
});

describe("buildBrainQualityCard — second opinion objected rate per prompt version", () => {
  it("is not_enough below OBJECTION_MIN_ROUNDS", () => {
    const few = Array.from({ length: OBJECTION_MIN_ROUNDS - 1 }, () => round("v1", "groq/a", "agreed"));
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: few, modes: ALL_OFF });
    const row = rows.find((r) => r.label === "Second opinion objected — v1")!;
    expect(row.status).toBe("not_enough");
    expect(row.value).toBeNull();
  });

  it("flags 'watch' above the B2 ceiling (0.7) once there are enough rounds", () => {
    const rounds = [
      ...Array.from({ length: 15 }, () => round("v2", "groq/a", "contested")),
      ...Array.from({ length: 5 }, () => round("v2", "groq/a", "agreed")),
    ];
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: rounds, modes: ALL_OFF });
    const row = rows.find((r) => r.label === "Second opinion objected — v2")!;
    expect(row.status).toBe("watch");
    expect(row.value).toBeCloseTo(0.75);
  });

  it("stays 'ok' at or below the ceiling", () => {
    const rounds = [
      ...Array.from({ length: 12 }, () => round("v3", "groq/a", "agreed")),
      ...Array.from({ length: 8 }, () => round("v3", "groq/a", "contested")),
    ];
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: rounds, modes: ALL_OFF });
    const row = rows.find((r) => r.label === "Second opinion objected — v3")!;
    expect(row.status).toBe("ok");
    expect(row.value).toBeCloseTo(0.4);
  });
});

describe("buildBrainQualityCard — agreement rate per proposer model", () => {
  it("is not_enough below 20 rounds", () => {
    const few = Array.from({ length: 19 }, () => round("v1", "groq/llama", "agreed"));
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: few, modes: ALL_OFF });
    const row = rows.find((r) => r.label === "Agreement rate — groq/llama")!;
    expect(row.status).toBe("not_enough");
    expect(row.value).toBeNull();
  });

  it("reports the agreed share once N >= 20", () => {
    const rounds = [
      ...Array.from({ length: 15 }, () => round("v1", "groq/llama", "agreed")),
      ...Array.from({ length: 5 }, () => round("v1", "groq/llama", "contested")),
    ];
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: rounds, modes: ALL_OFF });
    const row = rows.find((r) => r.label === "Agreement rate — groq/llama")!;
    expect(row.status).toBe("ok");
    expect(row.value).toBeCloseTo(0.75);
  });
});

describe("buildBrainQualityCard — legacy transcripts", () => {
  it("groups null promptVersion/model rows as 'before tracking' and excludes them from per-version/model rates", () => {
    const legacy = [round(null, null, "agreed"), round(null, null, "refuted")];
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: legacy, modes: ALL_OFF });
    expect(rows.some((r) => r.label.startsWith("Second opinion objected"))).toBe(false);
    expect(rows.some((r) => r.label.startsWith("Agreement rate"))).toBe(false);
    const before = rows.find((r) => r.label === "Before tracking (legacy)")!;
    expect(before.status).toBe("not_enough");
    expect(before.detail).toContain("2");
  });

  it("omits the legacy row entirely when there are none — never shown as a 0", () => {
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: [], modes: ALL_OFF });
    expect(rows.some((r) => r.label === "Before tracking (legacy)")).toBe(false);
  });
});

describe("buildBrainQualityCard — stage switches", () => {
  it("shows every stage's mode in plain words, with shadow shown as 'Watching only'", () => {
    const modes: Record<BrainStage, BrainMode> = { ...ALL_OFF, challenger: "shadow", gate: "on" };
    const rows = buildBrainQualityCard({ funnel: [], fetchedCount: 0, transcripts: [], modes });
    expect(rows.find((r) => r.label === "Second opinion")!.value).toBe("Watching only");
    expect(rows.find((r) => r.label === "Quality check")!.value).toBe("On");
    expect(rows.find((r) => r.label === "Evidence retrieval")!.value).toBe("Off");
    const modeRows = rows.filter(
      (r) => typeof r.value === "string" && ["Off", "On", "Watching only"].includes(r.value),
    );
    expect(modeRows).toHaveLength(BRAIN_STAGES.length);
  });
});

describe("buildBrainQualityCard — no internal vocabulary leaks into the card", () => {
  it("never shows a banned internal term anywhere in the card's text", () => {
    const rounds = [
      ...Array.from({ length: 15 }, () => round("v1", "groq/a", "contested")),
      ...Array.from({ length: 25 }, () => round("v1", "groq/b", "refuted")),
      round(null, null, "agreed"),
    ];
    const modes: Record<BrainStage, BrainMode> = { ...ALL_OFF, surprise: "shadow" };
    const rows = buildBrainQualityCard({
      funnel: [
        { stage: "analysis", decision: "surprise", count: 3 },
        { stage: "analysis", decision: "untestable", count: 1 },
        { stage: "analysis", decision: "gate", count: 1 },
        { stage: "analysis", decision: "analysed", count: 5 },
      ],
      fetchedCount: 10,
      transcripts: rounds,
      modes,
    });
    const banned = [
      "falsifier",
      "surprise",
      "predictive",
      "veil",
      "apophenia",
      "goodhart",
      "coastline",
      "heinz",
      "mmr",
      "shadow",
    ];
    const text = rows
      .flatMap((r) => [r.label, r.detail, typeof r.value === "string" ? r.value : ""])
      .join(" \n ")
      .toLowerCase();
    for (const word of banned) {
      expect(text).not.toContain(word);
    }
  });
});
