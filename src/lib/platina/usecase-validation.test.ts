import { describe, expect, it } from "vitest";
import {
  evaluateUseCases,
  formatValidationMarkdown,
  type UseCaseValidationInput,
} from "./usecase-validation";

function baseInput(overrides: Partial<UseCaseValidationInput> = {}): UseCaseValidationInput {
  return {
    workspaceSlug: "waters-gcc-internal",
    evaluatedAt: new Date("2026-11-13T07:00:00Z"),
    migrationsReady: true,
    brainModes: {
      interrogation: "on",
      challenger: "shadow",
      gate: "on",
      surprise: "shadow",
      retrieval: "on",
      budget: "on",
      grading: "shadow",
    },
    counts: {
      ownBrands: 1,
      competitors: 5,
      clientProfilePresent: true,
      firstPartyPassages: 2137,
      unembeddedFirstPartyPassages: 0,
      thirdPartyLeaksInFirstParty: 0,
      approvedBrandChunks: 25,
      minBaselineN: 20,
      approvedScanSpecs: 40,
      lateScanSpecs: 0,
      auditRunsTotal: 266,
      stuckAuditRuns: 0,
      failedAuditRuns24h: 0,
      signalDocumentsTotal: 643,
      signalDocumentsSkipped: 180,
      debateTranscriptsTotal: 280,
      blindedTranscripts: 12,
      findingsTotal: 487,
      activeBrainChunks: 322,
      supersededBrainChunks: 97,
      refutedBrainChunks: 2,
      falsifierBearingChunks: 18,
      dueFalsifierChunks: 4,
      insightGradesTotal: 5,
      brainTelemetry7d: 40,
      interestSignalsTotal: 703,
      topicsPassingMinN: 8,
      datedUpcomingEvents: 25,
      undatedEvents: 0,
      eventParticipantsTotal: 43,
      adLibraryReads: 255,
      plansTotal: 2,
      plansWithStatedTest: 2,
      planRevisionsWithTrigger: 1,
      creativesTotal: 8,
      metricSnapshotsTotal: 16,
      confirmedReviewsTotal: 6,
      learningMinN: 5,
      suggestionsTotal: 15,
      suggestionEventsTotal: 10,
      outcomesTotal: 2,
    },
    providers: {
      databaseOk: true,
      firecrawlOk: true,
      apifyOk: true,
      aiRouterOk: true,
    },
    ...overrides,
  };
}

describe("evaluateUseCases (strict realism validator)", () => {
  it("grades all 12 use cases as operational when modes, data, and providers are healthy", () => {
    const report = evaluateUseCases(baseInput());
    expect(report.summary.totalUseCases).toBe(12);
    expect(report.summary.codeVerifiedCount).toBe(12);
    expect(report.summary.operationalCount).toBe(12);
    expect(report.summary.liveOperationalReadinessPct).toBe(100);
    expect(report.summary.strictCompositeScore).toBeGreaterThanOrEqual(90);
  });

  it("refuses to grade Brain use cases as operational when brainModes are 'off' (dormant_mode_off)", () => {
    const input = baseInput({
      brainModes: {
        interrogation: "off",
        challenger: "off",
        gate: "off",
        surprise: "off",
        retrieval: "off",
        budget: "off",
        grading: "off",
      },
    });
    const report = evaluateUseCases(input);
    const uc03 = report.useCases.find((u) => u.id === "UC-03")!;
    const uc12 = report.useCases.find((u) => u.id === "UC-12")!;
    expect(uc03.liveStatus).toBe("dormant_mode_off");
    expect(uc03.score).toBeLessThanOrEqual(55);
    expect(uc12.liveStatus).toBe("dormant_mode_off");
    expect(uc12.score).toBeLessThanOrEqual(55);
    expect(report.nextOperations.some((op) => op.id === "OP-1")).toBe(true);
  });

  it("grades UC-09 and UC-11 as blocked_by_data when confirmed brand chunks or creative reviews are 0", () => {
    const base = baseInput();
    const report = evaluateUseCases({
      ...base,
      counts: {
        ...base.counts,
        approvedBrandChunks: 0,
        creativesTotal: 0,
        metricSnapshotsTotal: 0,
        confirmedReviewsTotal: 0,
      },
    });
    const uc09 = report.useCases.find((u) => u.id === "UC-09")!;
    const uc11 = report.useCases.find((u) => u.id === "UC-11")!;
    expect(uc09.liveStatus).toBe("blocked_by_data");
    expect(uc09.score).toBeLessThanOrEqual(50);
    expect(uc11.liveStatus).toBe("blocked_by_data");
    expect(uc11.score).toBeLessThanOrEqual(50);
    expect(report.nextOperations.map((o) => o.id)).toEqual(
      expect.arrayContaining(["OP-2", "OP-3"]),
    );
  });

  it("fails UC-01 immediately if any third-party URL leaked into first-party storage", () => {
    const base = baseInput();
    const report = evaluateUseCases({
      ...base,
      counts: { ...base.counts, thirdPartyLeaksInFirstParty: 3 },
    });
    const uc01 = report.useCases.find((u) => u.id === "UC-01")!;
    expect(uc01.liveStatus).toBe("failed");
    expect(uc01.score).toBeLessThanOrEqual(20);
  });

  it("formats a complete Markdown report with matrix and remediation queue", () => {
    const report = evaluateUseCases(baseInput());
    report.aiAdversarialCritique = {
      provider: "gemini",
      model: "gemini-2.5-flash",
      verdict: "Strict audit passed with 2 operational recommendations.",
    };
    const md = formatValidationMarkdown(report);
    expect(md).toContain("UC-01");
    expect(md).toContain("UC-12");
    expect(md).toContain("Higher-Intelligence Model Adversarial Critique");
  });
});
