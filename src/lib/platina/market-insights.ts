/**
 * Measured market insights -> Brain vectors (C5, "insight enhancer"). Pure.
 *
 * The debate path already turns each collected page into an embedded Brain
 * claim the planner and ideation retrieve. The measured layer built in
 * C3/C4 — what people engage with, where competitors pay, which events are
 * coming and who is going — never reached the Brain, so a plan written for
 * Waters could not know "mass spectrometry draws 1.24× engagement" or
 * "ARABLAB LIVE is in 35 days, no competitor listed". This module states each
 * such measurement as one plain sentence, so it can be embedded and retrieved
 * like any other insight.
 *
 * Rules:
 *  - Only what passed its gate: a topic at min-N ("ok"), a dated upcoming
 *    event. Below the gate there is nothing to say, so nothing is written.
 *  - The sentence carries the measured numbers and the date the data runs
 *    to — not today's date, so an unchanged measurement is an unchanged
 *    sentence and is not re-embedded daily.
 *  - `sourceSignalIds` are the documents behind it, strongest first: the
 *    first one is what the planner cites, and all of them decide which
 *    client's plans may use it.
 *  - `confidence` is the strength of the proof (sample size; a date read on
 *    the event's own page vs. a post), stated as a rule below — not a model
 *    score.
 */
import type { BrainMode } from "./brain-modes";
import { daysUntil, eventTiming } from "./events";
import type { TopicMomentum } from "./interest";
import { subjectKeyFor, type FalsifierClaim } from "./falsifier-metrics";
import { isSignificant, mannWhitneyOneSided, splitRecentBaseline } from "./significance";

export type MarketInsight = {
  key: string;
  content: string;
  sourceSignalIds: string[];
  confidence: number;
  // B1 (metacognitive Brain) — code-built, not model-written: a measured
  // insight either fits a registry metric (falsifier set, from the SAME
  // numbers already stated in `content`) or it does not, and says so by
  // leaving `falsifier` null rather than inventing a test (plan §5 B1).
  // Undefined on a producer that has not been updated for B1 yet (ads-view.ts
  // adInsights) — market-insight-writer.ts treats that the same as null.
  falsifier?: FalsifierClaim | null;
  subjectKey?: string | null;
  direction?: "up" | "down" | "none";
  /**
   * B3 (gate) — the significance check's own verdict on this insight's
   * stated trend, when there was one to test. Always computed (cheap, pure)
   * whenever `m.change !== null`, regardless of gate mode, so a "shadow"
   * caller can log what the check WOULD have changed without that override
   * actually happening (plan §5 B3: "off/shadow -> content unchanged
   * (shadow logs what would change)"). Undefined when there was nothing to
   * test (no stated trend, or a pressure insight).
   */
  gateCheck?: { significant: boolean; reason: string };
};

export type InsightSignal = {
  topic: string;
  region: string;
  signalKind: string;
  value: number;
  observedAt: Date;
  documentId: string | null;
  brandId: string | null;
};

const fmt = (x: number) => (Math.round(x * 100) / 100).toString();
const day = (d: Date) => new Date(d).toISOString().slice(0, 10);

/** Proof strength from sample size: 0.6 at the min-N gate, +0.02 per extra point, max 0.9. */
export function sampleConfidence(n: number): number {
  return Math.round(Math.min(0.9, 0.6 + Math.max(0, n - 5) * 0.02) * 100) / 100;
}

/** Documents behind a topic's signals, strongest first, deduped. */
function docsFor(signals: InsightSignal[], topic: string, kind: string, region?: string): string[] {
  const rows = signals
    .filter((s) => s.topic === topic && s.signalKind === kind && (region === undefined || s.region === region))
    .sort((a, b) => b.value - a.value);
  return [...new Set(rows.map((s) => s.documentId).filter((id): id is string => Boolean(id)))];
}

export function interestInsights(input: {
  client: { id: string; name: string };
  names: Map<string, string>;
  momentum: TopicMomentum[];
  signals: InsightSignal[];
  /** B3 (gate) — defaults "off": today's B1 behaviour, byte-identical. */
  gateMode?: BrainMode;
  /** B3 — "now" the significance check's recent/baseline windows are measured against. Defaults to now; irrelevant when there is no stated trend to test. */
  now?: Date;
}): MarketInsight[] {
  const gateMode = input.gateMode ?? "off";
  const now = input.now ?? new Date();
  const out: MarketInsight[] = [];
  for (const m of input.momentum) {
    if (m.status !== "ok") continue;
    const rows = input.signals.filter(
      (s) => s.topic === m.topic && s.signalKind === m.signalKind && s.region === m.region,
    );
    if (rows.length === 0) continue;
    const latest = day(new Date(Math.max(...rows.map((s) => new Date(s.observedAt).getTime()))));
    const top = [...rows].sort((a, b) => b.value - a.value)[0];
    const who = input.names.get(top.brandId ?? "") ?? "a company";
    const companies = new Set(rows.map((s) => s.brandId)).size;
    if (m.signalKind === "interest") {
      const value = m.recent ?? m.baseline!;
      let trend =
        m.recent !== null && m.baseline !== null
          ? ` That is ${m.change! >= 0 ? "up" : "down"} from ${fmt(m.baseline)}× in the 90 days before.`
          : "";
      let falsifierFields: Pick<MarketInsight, "falsifier" | "subjectKey" | "direction"> =
        m.change === null
          ? { falsifier: null, subjectKey: subjectKeyFor({ topic: m.topic }), direction: "none" }
          : {
              falsifier: {
                metric: "topic_momentum",
                subject: { topic: m.topic },
                direction: m.change >= 0 ? "below" : "above",
                threshold: 1.0,
                window_days: 30,
              },
              subjectKey: subjectKeyFor({ topic: m.topic }),
              direction: m.change >= 0 ? "up" : "down",
            };

      // B3 (gate): a stated trend is checked against a one-sided
      // Mann-Whitney test on the RAW per-post observations behind this
      // topic (the same rows `rows` above, already scoped to this
      // topic/region/signalKind) — not the medians `m` already reduced them
      // to. Computed whenever there is a trend to test, regardless of mode,
      // so "shadow" can log what the check would have changed without that
      // change actually happening (content/falsifier only flip at mode
      // "on"). Below the min-N floor `isSignificant` says "not enough data"
      // rather than treating a thin sample as settled either way.
      let gateCheck: { significant: boolean; reason: string } | undefined;
      if (gateMode !== "off" && m.change !== null) {
        const { recent, baseline } = splitRecentBaseline(
          rows.map((s) => ({ value: s.value, observedAt: s.observedAt })),
          now,
        );
        const mw = mannWhitneyOneSided(recent, baseline, m.change >= 0 ? "greater" : "less");
        gateCheck = isSignificant(mw);

        if (gateMode === "on" && !gateCheck.significant) {
          trend = " That is not clearly different from usual.";
          falsifierFields = { falsifier: null, subjectKey: subjectKeyFor({ topic: m.topic }), direction: "none" };
        }
      }

      out.push({
        key: `interest:${input.client.id}:${m.topic}`,
        content:
          `Market interest for ${input.client.name} (LinkedIn, data to ${latest}): posts about ${m.topic} drew ` +
          `${fmt(value)}× their company's typical engagement, across ${m.n} posts from ${companies} ` +
          `compan${companies === 1 ? "y" : "ies"}.${trend} Strongest: ${who}, ${fmt(top.value)}× on ${day(top.observedAt)}.`,
        sourceSignalIds: docsFor(input.signals, m.topic, "interest", m.region),
        confidence: sampleConfidence(m.n),
        // B1: the testable part is the trend `content` states ("up/down
        // from … in the 90 days before"), checked as topic_momentum in the
        // stated direction: an "up" claim is refuted if momentum falls back
        // below parity within 30 days, a "down" claim if it rises above it.
        // No trend stated (no baseline) → nothing to test, so no falsifier.
        ...falsifierFields,
        ...(gateCheck ? { gateCheck } : {}),
      });
    } else {
      out.push({
        key: `pressure:${input.client.id}:${m.topic}:${m.region}`,
        content:
          `Competitor ad pressure for ${input.client.name} (data to ${latest}): ${m.n} ads about ${m.topic}` +
          `${m.region !== "global" ? ` in ${m.region}` : ""}; the longest-running (${who}) has run ` +
          `${Math.round(top.value)} days — an ad kept that long is one the advertiser believes in.`,
        sourceSignalIds: docsFor(input.signals, m.topic, "pressure", m.region),
        confidence: sampleConfidence(m.n),
        // B1: no falsifier. The insight describes what is running now; it
        // predicts nothing. A test against the longest-running ad's days
        // would be refuted by the registry's own measure (the MEDIAN days
        // running), which almost always sits below the maximum.
        falsifier: null,
        subjectKey: subjectKeyFor({ brand: who, topic: m.topic }),
        direction: "none",
      });
    }
  }
  return out;
}

export type InsightEvent = {
  eventKey: string;
  name: string;
  format: string;
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  country: string | null;
  documentId: string | null;
  detail: unknown;
  participants: { brandId: string; evidence: string; documentId: string | null }[];
};

const EVIDENCE: Record<string, string> = {
  listed_exhibitor: "on the exhibitor list",
  mentioned_on_event_page: "named on the event page",
  announced_in_post: "announced it in a post",
};

/**
 * One insight per dated upcoming event. Workspace-level: who is going is
 * stated by name, so every client's plan reads it in its own terms.
 */
export function eventInsights(input: {
  names: Map<string, string>;
  events: InsightEvent[];
  now: Date;
}): MarketInsight[] {
  const out: MarketInsight[] = [];
  for (const e of input.events) {
    if (!e.startsOn || eventTiming(e, input.now) !== "upcoming") continue;
    const when = e.endsOn && e.endsOn !== e.startsOn ? `${e.startsOn} to ${e.endsOn}` : e.startsOn;
    const where = e.format === "online" ? "online" : [e.location, e.country].filter(Boolean).join(", ") || "place not stated";
    const going = [
      ...new Map(
        e.participants
          .filter((p) => input.names.has(p.brandId))
          .map((p) => [p.brandId, `${input.names.get(p.brandId)} (${EVIDENCE[p.evidence] ?? p.evidence})`]),
      ).values(),
    ];
    const readAt = (e.detail as { readAt?: string } | null)?.readAt;
    const who =
      going.length > 0
        ? `Going: ${going.join("; ")}.`
        : readAt
          ? `No tracked company named on the event page read ${readAt.slice(0, 10)}.`
          : "No tracked company has announced it yet.";
    out.push({
      // The date is part of the key's sentence, not the key: a corrected date
      // replaces the old insight instead of adding a second one.
      key: `event:${e.eventKey}`,
      content: `Upcoming ${e.format === "online" ? "online event" : "event"}: ${e.name}, ${when}, ${where}. ${who} (${daysUntil(e.startsOn, input.now) >= 21 ? "enough time to prepare" : "short notice"} as of the last read.)`,
      sourceSignalIds: [
        ...new Set([e.documentId, ...e.participants.map((p) => p.documentId)].filter((id): id is string => Boolean(id))),
      ],
      // A date read on the event's own page is firmer than one in a post.
      confidence: readAt ? 0.8 : 0.65,
      // B1: `event_participants` only counts — it has no above/below
      // trigger a "who is going" statement could be wrong against, so this
      // is left untestable rather than given a test that is not really one
      // (plan §5 B1: "if a measured insight kind has no fitting registry
      // metric, leave falsifier null and say so").
      falsifier: null,
      subjectKey: null,
      direction: "none",
    });
  }
  return out;
}

export type InsightPlan = {
  insert: MarketInsight[];
  /** Active chunk ids replaced by a changed measurement or no longer true. */
  supersede: string[];
};

/**
 * What to write, given what is active now under the same key prefix. An
 * unchanged sentence is left alone (no re-embedding); a changed one is
 * replaced; a key that no longer holds (topic fell below the gate, event
 * passed) is retired.
 */
export function planInsightWrites(
  wanted: MarketInsight[],
  active: { id: string; insightKey: string | null; content: string }[],
): InsightPlan {
  const byKey = new Map(active.filter((a) => a.insightKey).map((a) => [a.insightKey!, a]));
  const wantedKeys = new Set(wanted.map((w) => w.key));
  const insert = wanted.filter((w) => byKey.get(w.key)?.content !== w.content);
  const supersede = [
    ...insert.flatMap((w) => (byKey.has(w.key) ? [byKey.get(w.key)!.id] : [])),
    ...active.filter((a) => a.insightKey && !wantedKeys.has(a.insightKey)).map((a) => a.id),
  ];
  return { insert, supersede };
}
