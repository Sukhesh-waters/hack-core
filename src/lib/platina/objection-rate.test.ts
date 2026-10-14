import { describe, expect, it } from "vitest";
import {
  AGREEMENT_GAP_CEILING,
  BRAIN_OBJECTION_CEILING,
  OBJECTION_RATE_CEILING,
  agreementGapAlarm,
  objectionCeilingExceeded,
  objectionRate,
  objectionRateBy,
  type AgreementRound,
} from "./objection-rate";

const rounds = (state: "agreed" | "contested" | "refuted", n: number) =>
  Array.from({ length: n }, () => ({ state }));

describe("objectionRate", () => {
  it("is zero with no rounds", () => {
    expect(objectionRate([])).toBe(0);
  });

  it("counts contested and refuted as objections", () => {
    const mix = [
      ...rounds("agreed", 6),
      ...rounds("contested", 3),
      ...rounds("refuted", 1),
    ];
    expect(objectionRate(mix)).toBe(0.4);
  });
});

describe("OBJECTION_RATE_CEILING (the live v1 path's ceiling — untouched by B2)", () => {
  it("stays 0.8: contradict-sweep.ts and findings/page.tsx read this constant on today's non-blind debate, and B2 does not touch the live path", () => {
    expect(OBJECTION_RATE_CEILING).toBe(0.8);
  });
});

describe("BRAIN_OBJECTION_CEILING (B2 — the Brain quality card's own, lower ceiling)", () => {
  it("is 0.7, and is a different constant from the live OBJECTION_RATE_CEILING (0.8)", () => {
    expect(BRAIN_OBJECTION_CEILING).toBe(0.7);
    expect(BRAIN_OBJECTION_CEILING).not.toBe(OBJECTION_RATE_CEILING);
  });
});

describe("objectionCeilingExceeded", () => {
  it("never alarms below the minimum window", () => {
    expect(objectionCeilingExceeded(rounds("contested", 9))).toBe(false);
    expect(objectionCeilingExceeded(rounds("refuted", 2))).toBe(false);
  });

  it("alarms at or above the ceiling with enough rounds", () => {
    expect(objectionCeilingExceeded(rounds("contested", 10))).toBe(true);
    const atCeiling = [...rounds("contested", 8), ...rounds("agreed", 2)];
    expect(objectionCeilingExceeded(atCeiling)).toBe(true);
  });

  it("stays quiet below the ceiling", () => {
    const below = [...rounds("contested", 7), ...rounds("agreed", 3)];
    expect(objectionCeilingExceeded(below)).toBe(false);
  });

  it("the Brain quality card's lower ceiling (0.7) is passed explicitly, never the default", () => {
    const sevenOfTen = [...rounds("contested", 7), ...rounds("agreed", 3)];
    expect(objectionCeilingExceeded(sevenOfTen, BRAIN_OBJECTION_CEILING)).toBe(true);
    expect(objectionCeilingExceeded(sevenOfTen)).toBe(false);
  });
});

describe("objectionRateBy (B2 — per prompt version / proposer model / blinded arm)", () => {
  it("groups by the given key and computes each group's rate independently", () => {
    const tagged = [
      ...rounds("contested", 2).map((r) => ({ ...r, arm: "blind" as const })),
      ...rounds("agreed", 8).map((r) => ({ ...r, arm: "blind" as const })),
      ...rounds("contested", 7).map((r) => ({ ...r, arm: "not blind" as const })),
      ...rounds("agreed", 3).map((r) => ({ ...r, arm: "not blind" as const })),
    ];
    const byArm = objectionRateBy(tagged, (r) => r.arm);
    expect(byArm).toEqual([
      { key: "blind", rate: 0.2, n: 10 },
      { key: "not blind", rate: 0.7, n: 10 },
    ]);
  });

  it("excludes rounds whose key resolves to null, rather than folding them into a group", () => {
    const tagged = [
      ...rounds("contested", 5).map((r) => ({ ...r, version: "v1" as string | null })),
      ...rounds("agreed", 5).map((r) => ({ ...r, version: null as string | null })),
    ];
    const byVersion = objectionRateBy(tagged, (r) => r.version);
    expect(byVersion).toEqual([{ key: "v1", rate: 1, n: 5 }]);
  });

  it("returns an empty list for no rounds", () => {
    expect(objectionRateBy([] as { state: "agreed" }[], () => "x")).toEqual([]);
  });
});

describe("agreementGapAlarm (B2 — 'blinding failed' when proposer models disagree)", () => {
  it("is quiet below minPerModel even with a huge gap", () => {
    const agreementRounds: AgreementRound[] = [
      ...Array.from({ length: 19 }, () => ({ state: "agreed" as const, proposerModel: "model-a" })),
      ...Array.from({ length: 19 }, () => ({ state: "contested" as const, proposerModel: "model-b" })),
    ];
    const alarm = agreementGapAlarm(agreementRounds, { minPerModel: 20, maxGap: AGREEMENT_GAP_CEILING });
    expect(alarm.alarmed).toBe(false);
    expect(alarm.rates).toEqual([]);
  });

  it("alarms once both models clear minPerModel and differ by more than the gap ceiling", () => {
    const agreementRounds: AgreementRound[] = [
      ...Array.from({ length: 20 }, () => ({ state: "agreed" as const, proposerModel: "model-a" })),
      ...Array.from({ length: 16 }, () => ({ state: "contested" as const, proposerModel: "model-b" })),
      ...Array.from({ length: 4 }, () => ({ state: "agreed" as const, proposerModel: "model-b" })),
    ];
    const alarm = agreementGapAlarm(agreementRounds, { minPerModel: 20, maxGap: AGREEMENT_GAP_CEILING });
    expect(alarm.alarmed).toBe(true);
    expect(alarm.rates).toEqual([
      { model: "model-a", rate: 1, n: 20 },
      { model: "model-b", rate: 0.2, n: 20 },
    ]);
    expect(alarm.gap).toEqual({ models: ["model-a", "model-b"], difference: 0.8 });
  });

  it("stays quiet when both models clear minPerModel but agree closely", () => {
    const agreementRounds: AgreementRound[] = [
      ...Array.from({ length: 20 }, () => ({ state: "agreed" as const, proposerModel: "model-a" })),
      ...Array.from({ length: 18 }, () => ({ state: "agreed" as const, proposerModel: "model-b" })),
      ...Array.from({ length: 2 }, () => ({ state: "contested" as const, proposerModel: "model-b" })),
    ];
    const alarm = agreementGapAlarm(agreementRounds, { minPerModel: 20, maxGap: AGREEMENT_GAP_CEILING });
    expect(alarm.alarmed).toBe(false);
    expect(alarm.gap).toBeUndefined();
  });

  it("excludes a null proposerModel from every group (legacy rows, not a phantom model)", () => {
    const agreementRounds: AgreementRound[] = [
      ...Array.from({ length: 25 }, () => ({ state: "agreed" as const, proposerModel: null })),
    ];
    const alarm = agreementGapAlarm(agreementRounds, { minPerModel: 20, maxGap: AGREEMENT_GAP_CEILING });
    expect(alarm.rates).toEqual([]);
    expect(alarm.alarmed).toBe(false);
  });
});
