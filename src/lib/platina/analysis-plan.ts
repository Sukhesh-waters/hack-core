/**
 * What happens to one collected document before any provider is called
 * (core spine R1+R2). This is where the cost guarantee lives: if this returns
 * a skip, no model call, no embedding and no previous-version query happen.
 *
 * DB-free — the caller injects `loadPrevious`, so the ordering guarantee
 * ("cheap checks first") is provable in a unit test rather than asserted in a
 * comment.
 *
 * B4 (metacognitive Brain, wired in W3a): the same DB-free pattern extends to
 * the surprise filter. `params.surprise` injects `loadExpectation`/
 * `saveExpectation` exactly like `loadPrevious` above; absent, or
 * `mode: "off"`, this function is byte-identical to before this slice (plan
 * §2.1, §11.5 golden test) — no expectation read, no expectation write, no
 * extra field on the returned plan.
 */
import { buildAnalysisInput, type AnalysisInputParts, type AnalysisSubject } from "./analysis-input";
import { summariseChange, type ChangeSide, type ChangeSummary } from "./change-diff";
import { scoreSignal } from "./signal-value";
import { engagementOf } from "./interest";
import { adEndedAt, adStartedAt } from "./interest-extract";
import {
  decideSurprise,
  expectationKey,
  hasDateOrPrice,
  novelty,
  type Expectation,
  type SurpriseSided,
} from "./surprise";
import type { BrainMode } from "./brain-modes";
import type { PlatinaSignalMetrics } from "@/db/platina-schema";

const DAY_MS = 86_400_000;

export type AnalysisSubjectRow = {
  kind: string | null;
  brandName: string | null;
  clientName: string | null;
  sourceKind: string | null;
  /** B4 — the id of the brand this scan spec watches (competitor or client); needed to key the per-brand engagement/ads expectation. Null for an unlinked source, where those two kinds skip the filter (cannot form a key). */
  brandId?: string | null;
} | null;

export type AnalysisSignalRow = {
  title: string | null;
  body: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  sourceKind: string | null;
  fetchedAt: Date | string;
  metrics?: PlatinaSignalMetrics | null;
  /** B4 — ad-library snapshots carry their start/end date here (interest-extract.ts adStartedAt/adEndedAt); absent for every other source kind. */
  raw?: unknown;
};

/**
 * B4 — the surprise-filter dependency (plan §5 B4; continuation handoff §2
 * finding 1). DB-free like `loadPrevious`: `signal-analyze.ts` supplies the
 * real Postgres-backed read/write (db/queries/platina-expectations.ts); this
 * module only decides WHICH key/value to feed `decideSurprise` and what to
 * do with its verdict (plan §2.1's per-mode table).
 */
export type SurpriseDeps = {
  /** This stage's OWN mode (`modeOf(config, "surprise")`) — "off" (the default) behaves as if this whole param were omitted. */
  mode: BrainMode;
  loadExpectation: (key: string) => Promise<Expectation | null>;
  saveExpectation: (key: string, next: Expectation) => Promise<void>;
  /** The signal document's own id — the audit sample's deterministic draw. */
  docId: string;
  /** Workspace config's `surpriseFloor`. Omitted -> decideSurprise's own default (1.0). */
  floor?: number;
  /** Workspace config's `surpriseAuditShare`. Omitted -> decideSurprise's own default (0.1). */
  auditShare?: number;
};

/** What the filter would have decided, mode "shadow" only — logged by the caller, never written to any table by this module itself. */
export type SurpriseShadowLog = { wouldSkip: boolean; reason: string; deviation: number | null };

export type AnalysisPlan =
  | { action: "skip"; reason: string; cause: "own_brand" | "low_value" | "surprise" }
  | {
      action: "analyse";
      input: string;
      changed: boolean;
      /**
       * B1 — the same parts `buildAnalysisInput` just turned into `input`,
       * kept so a mode shadow/on caller can additionally number them
       * (analysis-input.ts buildNumberedAnalysisInput) without re-deriving
       * the subject/change/metrics this function already assembled. Unused
       * (and free to ignore) on the mode="off" path. Optional only so that
       * pre-B1 test fixtures constructing an `AnalysisPlan` literal by hand
       * (analysis-writes.test.ts) still type-check; `planAnalysis` itself
       * always sets it.
       */
      parts?: AnalysisInputParts;
      /** B4, mode "shadow" only (plan §2.1: "measures the filter's false-negative rate for free"). */
      surprise?: SurpriseShadowLog;
      /** B4, mode "on" only — the statistic said skip, but the deterministic audit sample chose to analyse anyway (plan §5 B4); the caller labels the eventual outcome "audit sample" rather than an ordinary analysed document. */
      audit?: boolean;
    };

export const OWN_BRAND_SKIP = "the client's own page — used for its profile";

/** Standard-deviation floor for a [0,1]-bounded statistic (novelty). */
const NOVELTY_FLOOR_SD = 0.05;
/** Standard-deviation floor for an unbounded count (engagement, ad days running) — just enough that a key with no variance yet does not divide by ~0. */
const COUNT_FLOOR_SD = 1;

type SurpriseObservation = {
  key: string;
  value: number;
  floorSd: number;
  sided: SurpriseSided;
  hasDateOrPrice: boolean;
  firstSeen: boolean;
};

/**
 * What to feed `decideSurprise`, by source kind (plan §5 B4 table, as wired
 * here): novelty for a web/press/trade page — the only kind with a
 * previous-version diff to measure — the engagement count for a social
 * post, the ad's own days-running for an ad-library snapshot. Returns null
 * to mean "skip the filter for this one document": no metric is computable,
 * so (CLAUDE.md: never synthesise a number) the debate runs exactly as it
 * would with the stage off.
 */
function surpriseObservation(args: {
  sourceKind: string | null;
  canonicalUrl: string;
  change: ChangeSummary | null;
  previousBody: string | null;
  isFirstSighting: boolean;
  metrics: PlatinaSignalMetrics | null;
  brandId: string | null;
  raw: unknown;
  fetchedAt: Date;
}): SurpriseObservation | null {
  if (args.sourceKind === "social_posts") {
    if (!args.brandId) return null; // cannot form a per-brand key — skip the filter
    const engagement = engagementOf(args.metrics);
    if (engagement === null) return null; // "if computable from metrics, else skip the filter"
    return {
      key: expectationKey.engagement(args.brandId),
      value: engagement,
      floorSd: COUNT_FLOOR_SD,
      sided: "both",
      hasDateOrPrice: false,
      firstSeen: false,
    };
  }

  if (args.sourceKind === "ad_library") {
    if (!args.brandId) return null;
    const started = adStartedAt(args.raw);
    if (!started) return null; // "skip the filter unless ad_days_running is available" — never invented
    const ended = adEndedAt(args.raw);
    const until = ended && ended.getTime() < args.fetchedAt.getTime() ? ended : args.fetchedAt;
    const daysRunning = Math.max(1, Math.round((until.getTime() - started.getTime()) / DAY_MS) + 1);
    return {
      key: expectationKey.ads(args.brandId),
      value: daysRunning,
      floorSd: COUNT_FLOOR_SD,
      sided: "both",
      hasDateOrPrice: false,
      firstSeen: false,
    };
  }

  // web / press / trade / social_profile / unlinked — novelty of the added
  // text against the one previous version this job already loaded.
  const addedText = args.change?.added.join(" ") ?? "";
  // Empty added text (a cosmetic-only change, or no previous version at
  // all) is the LEAST novel case, not the most: novelty(added, prev) would
  // read 1 (maximally novel) for an empty `added` set, because an empty
  // word set shares nothing with anything by construction (consolidate.ts
  // similarity() returns 0 for an empty set either side) — scored 0 by hand
  // instead, which is what "nothing new was added" actually means.
  const observed =
    addedText.trim().length > 0 ? novelty(addedText, args.previousBody ? [args.previousBody] : []) : 0;
  return {
    key: expectationKey.novelty(args.canonicalUrl),
    value: observed,
    floorSd: NOVELTY_FLOOR_SD,
    sided: "up",
    hasDateOrPrice: addedText.trim().length > 0 && hasDateOrPrice(addedText),
    firstSeen: args.isFirstSighting,
  };
}

export async function planAnalysis(params: {
  signal: AnalysisSignalRow;
  subject: AnalysisSubjectRow;
  /** Called only when the document has earned an analysis. */
  loadPrevious: () => Promise<ChangeSide | null>;
  /** B4 — optional; absent or mode "off" changes nothing (see file header). */
  surprise?: SurpriseDeps;
}): Promise<AnalysisPlan> {
  const { signal, subject } = params;

  // 1. A client's own page feeds its profile, never the competitor debate.
  if (subject?.kind === "own_brand") {
    return { action: "skip", reason: OWN_BRAND_SKIP, cause: "own_brand" };
  }

  // 2. Is it worth two model calls? Cheapest check, so it comes before any IO.
  const verdict = scoreSignal({
    url: signal.canonicalUrl ?? signal.sourceUrl,
    title: signal.title,
    body: signal.body,
    sourceKind: signal.sourceKind ?? subject?.sourceKind ?? null,
    metricsPresent: Boolean(signal.metrics),
  });
  if (!verdict.worthAnalysing) {
    return { action: "skip", reason: verdict.reason, cause: "low_value" };
  }

  // 3. Only now: what did this page look like last time?
  const previous = await params.loadPrevious();
  const change = previous
    ? summariseChange(previous, {
        title: signal.title,
        body: signal.body,
        fetchedAt: signal.fetchedAt,
      })
    : null;

  // 4. B4 — the surprise filter (plan §5 B4), after `loadPrevious`/`change`
  // (novelty needs them) and before the analyse verdict below. DB-free: see
  // the file header and `SurpriseDeps`.
  let surpriseShadow: SurpriseShadowLog | undefined;
  let auditSample = false;
  const surprise = params.surprise;
  if (surprise && surprise.mode !== "off") {
    const observation = surpriseObservation({
      sourceKind: signal.sourceKind ?? subject?.sourceKind ?? null,
      canonicalUrl: signal.canonicalUrl ?? signal.sourceUrl,
      change,
      previousBody: previous?.body ?? null,
      isFirstSighting: previous === null,
      metrics: signal.metrics ?? null,
      brandId: subject?.brandId ?? null,
      raw: signal.raw ?? null,
      fetchedAt: new Date(signal.fetchedAt),
    });
    if (observation) {
      const expectation = await surprise.loadExpectation(observation.key);
      const decision = decideSurprise({
        expectation,
        observed: observation.value,
        floor: surprise.floor,
        floorSd: observation.floorSd,
        auditShare: surprise.auditShare,
        firstSeen: observation.firstSeen,
        hasDateOrPrice: observation.hasDateOrPrice,
        docId: surprise.docId,
        sided: observation.sided,
      });
      // Persisted for EVERY observation, surprising or not — see surprise.ts.
      await surprise.saveExpectation(observation.key, decision.next);

      if (surprise.mode === "on" && decision.action === "skip") {
        return { action: "skip", reason: decision.reason, cause: "surprise" };
      }
      if (surprise.mode === "on" && decision.action === "audit") {
        auditSample = true;
      }
      if (surprise.mode === "shadow") {
        surpriseShadow = {
          wouldSkip: decision.action !== "analyse",
          reason: decision.reason,
          deviation: decision.deviation,
        };
      }
    }
  }

  const analysisSubject: AnalysisSubject = {
    competitorName: subject?.brandName ?? null,
    clientName: subject?.clientName ?? null,
    sourceKind: signal.sourceKind ?? subject?.sourceKind ?? null,
    url: signal.canonicalUrl ?? signal.sourceUrl,
    collectedAt: signal.fetchedAt,
  };

  const parts: AnalysisInputParts = {
    subject: analysisSubject,
    title: signal.title,
    body: signal.body,
    change,
    metrics: signal.metrics ?? null,
  };

  return {
    action: "analyse",
    changed: change !== null,
    input: buildAnalysisInput(parts),
    parts,
    ...(surpriseShadow ? { surprise: surpriseShadow } : {}),
    ...(auditSample ? { audit: true } : {}),
  };
}
