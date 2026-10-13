/**
 * Golden test — plan §11.5 ("proof that 'off' is the same data").
 *
 * `signal-analyze.ts` used to decide inline what to write for a document
 * (skip+reason, transcript, Brain chunk, finding). B0 extracts that decision,
 * narrowly, into the pure `analysisWrites` (./analysis-writes.ts) so it is
 * unit-testable without a database. This test proves the extraction changed
 * nothing observable: it drives `planAnalysis` + `analysisWrites` over 9
 * recorded fixtures with a FAKE debate outcome and compares the result to
 * `__fixtures__/legacy-analysis-writes.json` — a snapshot hand-derived from
 * `main`'s inline logic (read, not generated, before this refactor touched
 * signal-analyze.ts). Telemetry/provenance fields are B0 additions and are
 * out of `analysisWrites`'s return shape entirely, so there is nothing to
 * exclude: if this test ever fails, something leaked past the extraction.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChangeSide } from "./change-diff";
import {
  planAnalysis,
  type AnalysisSignalRow,
  type AnalysisSubjectRow,
} from "./analysis-plan";
import {
  analysisWrites,
  type AnalysisWriteContext,
  type DebateOutcome,
} from "./analysis-writes";

const SNAPSHOT_PATH = join(__dirname, "__fixtures__", "legacy-analysis-writes.json");
const snapshot: Record<string, unknown> = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));

const noPrevious = (): Promise<ChangeSide | null> => Promise.resolve(null);

const baseSignal: AnalysisSignalRow = {
  title: "Roast guarantee",
  body: "Bluebird Roasters has introduced a 48-hour roast guarantee for wholesale buyers across the country. ".repeat(
    8,
  ),
  sourceUrl: "https://bluebird.example/news/roast-guarantee",
  canonicalUrl: "https://bluebird.example/news/roast-guarantee",
  sourceKind: "competitor_site",
  fetchedAt: new Date("2026-09-21T09:00:00Z"),
};

const competitor: AnalysisSubjectRow = {
  kind: "competitor",
  brandName: "Bluebird Roasters",
  clientName: "Northwind Coffee",
  sourceKind: "competitor_site",
};

function contextFor(signal: AnalysisSignalRow, subject: AnalysisSubjectRow): AnalysisWriteContext {
  return {
    competitorName: subject?.brandName ?? null,
    pageTitle: signal.title,
    sourceKind: signal.sourceKind ?? subject?.sourceKind ?? undefined,
  };
}

/** Round-trips through JSON so an omitted field and an explicit `undefined`
 * compare the same way the committed (necessarily undefined-free) snapshot does. */
const canon = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function writesFor(
  signal: AnalysisSignalRow,
  subject: AnalysisSubjectRow,
  debate: DebateOutcome | undefined,
  loadPrevious: () => Promise<ChangeSide | null> = noPrevious,
): Promise<unknown> {
  const plan = await planAnalysis({ signal, subject, loadPrevious });
  return canon(analysisWrites(plan, debate, contextFor(signal, subject)));
}

describe("brain-legacy-equivalence (plan §11.5)", () => {
  it("own_brand: a client's own page is marked processed, never written as a skip row", async () => {
    const writes = await writesFor(baseSignal, { ...competitor, kind: "own_brand" }, undefined);
    expect(writes).toEqual(snapshot.own_brand);
  });

  it("low_value boilerplate: skipped before any debate, with the boilerplate reason", async () => {
    const signal = {
      ...baseSignal,
      canonicalUrl: "https://bluebird.example/privacy",
      sourceUrl: "https://bluebird.example/privacy",
    };
    const writes = await writesFor(signal, competitor, undefined);
    expect(writes).toEqual(snapshot.low_value_boilerplate);
  });

  it("thin page: skipped before any debate, with the too-little-text reason", async () => {
    const signal = { ...baseSignal, body: "Call us." };
    const writes = await writesFor(signal, competitor, undefined);
    expect(writes).toEqual(snapshot.thin_page);
  });

  it("nothing-new, page unchanged: transcript kept, skipped as nothing_new", async () => {
    const debate: DebateOutcome = {
      claim: {
        text: "Bluebird reaffirms its wholesale roast guarantee.",
        evidenceSpans: ["48-hour roast guarantee"],
        specificity: 0.1,
      },
      attack: {
        text: "This restates existing marketing copy.",
        confounders: ["ordinary marketing"],
        strongestObjection: "no material objection",
        confounderStrength: 0,
      },
      result: { state: "agreed", score: 0.95 },
      headline: "nothing new",
      nothingNew: true,
    };
    const writes = await writesFor(baseSignal, competitor, debate);
    expect(writes).toEqual(snapshot.nothing_new_unchanged);
  });

  it("nothing-new, but the page DID change: the nothingNew flag is ignored once changed is true", async () => {
    const debate: DebateOutcome = {
      claim: {
        text: "Bluebird's roast guarantee language is unchanged from its profile copy.",
        evidenceSpans: ["48-hour roast guarantee"],
        specificity: 0.3,
      },
      attack: {
        text: "This looks like standing language rather than a new move, but the page did change elsewhere.",
        confounders: ["boilerplate reuse"],
        strongestObjection: "page changed but no concrete new claim is isolated",
        confounderStrength: 0.5,
      },
      result: {
        state: "qualified",
        score: 0.55,
        caveat: "page changed but no concrete new claim is isolated",
      },
      headline: "nothing new",
      nothingNew: true,
    };
    const loadPrevious = (): Promise<ChangeSide | null> =>
      Promise.resolve({
        title: "Roast guarantee",
        body: "Bluebird Roasters roasts to order for wholesale buyers across the country.",
        fetchedAt: new Date("2026-09-14T09:00:00Z"),
      });
    const writes = await writesFor(baseSignal, competitor, debate, loadPrevious);
    expect(writes).toEqual(snapshot.nothing_new_changed);
  });

  it("agreed: finding + Brain chunk, no caveat", async () => {
    const debate: DebateOutcome = {
      claim: {
        text: "Bluebird Roasters now guarantees a 48-hour roast turnaround for wholesale orders, undercutting the industry-standard 5-day window.",
        evidenceSpans: ["48-hour roast guarantee"],
        specificity: 0.85,
      },
      attack: {
        text: "The claim is well supported and no competitor offers a comparable guarantee today.",
        confounders: [],
        strongestObjection: "no material objection",
        confounderStrength: 0.05,
      },
      result: { state: "agreed", score: 0.88 },
      headline: "Bluebird Roasters now guarantees 48-hour roasts",
      nothingNew: false,
    };
    const writes = await writesFor(baseSignal, competitor, debate);
    expect(writes).toEqual(snapshot.agreed);
  });

  it("qualified with a caveat: the caveat rides on both the Brain chunk content and the finding", async () => {
    const debate: DebateOutcome = {
      claim: {
        text: "Bluebird Roasters is piloting a subscription box for small cafes in the Pacific Northwest.",
        evidenceSpans: ["subscription box", "Pacific Northwest"],
        specificity: 0.55,
      },
      attack: {
        text: "The pilot is limited to one region and may not reflect a broader strategy shift.",
        confounders: ["single-region pilot", "seasonal demand"],
        strongestObjection: "single-region pilot, not yet a broader strategy",
        confounderStrength: 0.45,
      },
      result: {
        state: "qualified",
        score: 0.58,
        caveat: "single-region pilot, not yet a broader strategy",
      },
      headline: "Bluebird pilots a cafe subscription box",
      nothingNew: false,
    };
    const writes = await writesFor(baseSignal, competitor, debate);
    expect(writes).toEqual(snapshot.qualified_with_caveat);
  });

  it("contested: a finding awaiting a human, no Brain chunk", async () => {
    const debate: DebateOutcome = {
      claim: {
        text: "Bluebird Roasters claims to be the fastest-growing wholesale roaster in the region.",
        evidenceSpans: ["fastest-growing"],
        specificity: 0.5,
      },
      attack: {
        text: "This is an unverifiable superlative with no supporting figures, and several competitors make the same claim.",
        confounders: ["unverifiable superlative", "common competitor claim"],
        strongestObjection: "unverifiable superlative with no supporting figures",
        confounderStrength: 0.8,
      },
      result: { state: "contested", score: 0.3 },
      headline: "Bluebird claims fastest growth in the region",
      nothingNew: false,
    };
    const writes = await writesFor(baseSignal, competitor, debate);
    expect(writes).toEqual(snapshot.contested);
  });

  it("refuted: only the transcript survives — no finding, no Brain chunk", async () => {
    const debate: DebateOutcome = {
      claim: {
        text: "Bluebird Roasters has secured exclusive national distribution with a major retailer.",
        evidenceSpans: ["exclusive national distribution"],
        specificity: 0.2,
      },
      attack: {
        text: "No retailer or contract is named, and the wording matches Bluebird's standard aspirational marketing language used for years.",
        confounders: ["no named retailer", "recurring marketing language", "no contract evidence"],
        strongestObjection: "no named retailer or contract; matches years of aspirational marketing copy",
        confounderStrength: 0.95,
      },
      result: { state: "refuted", score: 0.08 },
      headline: "Bluebird claims exclusive national distribution",
      nothingNew: false,
    };
    const writes = await writesFor(baseSignal, competitor, debate);
    expect(writes).toEqual(snapshot.refuted);
  });
});
