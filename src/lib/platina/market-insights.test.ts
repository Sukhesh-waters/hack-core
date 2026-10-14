import { describe, expect, it } from "vitest";
import type { TopicMomentum } from "./interest";
import { writeClientInsights, writeEventInsights, type InsightWriterDeps } from "./market-insight-writer";
import {
  eventInsights,
  interestInsights,
  planInsightWrites,
  sampleConfidence,
  type InsightEvent,
  type InsightSignal,
} from "./market-insights";

const now = new Date("2026-09-21T09:00:00Z");
const names = new Map([
  ["waters", "Waters"],
  ["sciex", "SCIEX"],
  ["agilent", "Agilent"],
]);

const sig = (over: Partial<InsightSignal>): InsightSignal => ({
  topic: "mass spectrometry",
  region: "global",
  signalKind: "interest",
  value: 1,
  observedAt: new Date("2026-09-10T00:00:00Z"),
  documentId: "d1",
  brandId: "waters",
  ...over,
});

const ms = (over: Partial<TopicMomentum> = {}): TopicMomentum => ({
  topic: "mass spectrometry",
  region: "global",
  signalKind: "interest",
  recent: 1.24,
  baseline: null,
  change: null,
  n: 13,
  status: "ok",
  proofs: [],
  ...over,
});

describe("interestInsights", () => {
  const signals = [
    sig({ documentId: "d1", value: 0.9 }),
    sig({ documentId: "d2", value: 4.18, brandId: "sciex", observedAt: new Date("2026-09-16T00:00:00Z") }),
    sig({ documentId: "d2", value: 4.18, brandId: "sciex", topic: "other" }),
  ];

  it("states the measurement in words, strongest proof first", () => {
    const [insight] = interestInsights({ client: { id: "waters", name: "Waters" }, names, momentum: [ms()], signals });
    expect(insight.key).toBe("interest:waters:mass spectrometry");
    expect(insight.content).toContain("posts about mass spectrometry drew 1.24×");
    expect(insight.content).toContain("data to 2026-09-16");
    expect(insight.content).toContain("Strongest: SCIEX, 4.18× on 2026-09-16");
    expect(insight.sourceSignalIds).toEqual(["d2", "d1"]);
    expect(insight.confidence).toBe(sampleConfidence(13));
  });

  it("writes nothing for a topic below the gate", () => {
    expect(
      interestInsights({ client: { id: "waters", name: "Waters" }, names, momentum: [ms({ status: "insufficient", n: 2 })], signals }),
    ).toEqual([]);
  });

  it("keeps ad pressure a separate, labelled insight", () => {
    const [p] = interestInsights({
      client: { id: "waters", name: "Waters" },
      names,
      momentum: [ms({ signalKind: "pressure", region: "AE", n: 6 })],
      signals: [sig({ signalKind: "pressure", region: "AE", value: 64, brandId: "agilent", documentId: "ad1" })],
    });
    expect(p.key).toBe("pressure:waters:mass spectrometry:AE");
    expect(p.content).toContain("Competitor ad pressure");
    expect(p.content).toContain("in AE");
    expect(p.content).toContain("(Agilent) has run 64 days");
  });

  it("does not change its sentence just because a day passed", () => {
    const a = interestInsights({ client: { id: "waters", name: "Waters" }, names, momentum: [ms()], signals });
    const b = interestInsights({ client: { id: "waters", name: "Waters" }, names, momentum: [ms()], signals });
    expect(a[0].content).toBe(b[0].content);
  });

  it("B1: a rising interest insight is tested as momentum falling back below parity, content text unchanged", () => {
    const [insight] = interestInsights({
      client: { id: "waters", name: "Waters" },
      names,
      momentum: [ms({ baseline: 0.9, change: 0.34 })],
      signals,
    });
    expect(insight.content).toContain("posts about mass spectrometry drew 1.24×"); // unchanged by B1
    expect(insight.falsifier).toEqual({
      metric: "topic_momentum",
      subject: { topic: "mass spectrometry" },
      direction: "below",
      threshold: 1.0,
      window_days: 30,
    });
    expect(insight.subjectKey).toBe("topic:mass spectrometry");
    expect(insight.direction).toBe("up");
  });

  it("B1: a falling interest insight is tested in ITS direction (refuted if momentum rises above parity)", () => {
    const [insight] = interestInsights({
      client: { id: "waters", name: "Waters" },
      names,
      momentum: [ms({ recent: 0.7, baseline: 1.3, change: -0.6 })],
      signals,
    });
    expect(insight.content).toContain("That is down from");
    expect(insight.falsifier).toMatchObject({ metric: "topic_momentum", direction: "above", threshold: 1.0 });
    expect(insight.direction).toBe("down");
  });

  it("B1: an interest insight with no stated trend (no baseline) has nothing to test", () => {
    const [insight] = interestInsights({ client: { id: "waters", name: "Waters" }, names, momentum: [ms()], signals });
    expect(insight.falsifier).toBeNull();
    expect(insight.direction).toBe("none");
  });

  it("B1: a pressure insight carries NO falsifier — it describes what runs now and predicts nothing", () => {
    const [p] = interestInsights({
      client: { id: "waters", name: "Waters" },
      names,
      momentum: [ms({ signalKind: "pressure", region: "AE", n: 6 })],
      signals: [sig({ signalKind: "pressure", region: "AE", value: 64, brandId: "agilent", documentId: "ad1" })],
    });
    expect(p.content).toContain("(Agilent) has run 64 days"); // unchanged by B1
    expect(p.falsifier).toBeNull();
    expect(p.subjectKey).toBe("brand:Agilent|topic:mass spectrometry");
    expect(p.direction).toBe("none");
  });
});

describe("sampleConfidence", () => {
  it("rises with sample size, from the gate, capped", () => {
    expect(sampleConfidence(5)).toBe(0.6);
    expect(sampleConfidence(13)).toBe(0.76);
    expect(sampleConfidence(500)).toBe(0.9);
  });
});

describe("eventInsights", () => {
  const arablab: InsightEvent = {
    eventKey: "arablab-2026",
    name: "ARABLAB LIVE 2026",
    format: "in_person",
    startsOn: "2026-10-26",
    endsOn: "2026-10-28",
    location: "Dubai World Trade Centre",
    country: "AE",
    documentId: "page1",
    detail: { readAt: "2026-09-22T00:10:00Z" },
    participants: [],
  };

  it("says when, where, and that no tracked company was named on the page", () => {
    const [e] = eventInsights({ names, events: [arablab], now });
    expect(e.key).toBe("event:arablab-2026");
    expect(e.content).toContain("ARABLAB LIVE 2026, 2026-10-26 to 2026-10-28, Dubai World Trade Centre, AE");
    expect(e.content).toContain("No tracked company named on the event page read 2026-09-22");
    expect(e.confidence).toBe(0.8);
    expect(e.sourceSignalIds).toEqual(["page1"]);
  });

  it("B1: has no falsifier — event_participants is a count, not an above/below test, so this says so rather than inventing one", () => {
    const [e] = eventInsights({ names, events: [arablab], now });
    expect(e.falsifier).toBeNull();
    expect(e.direction).toBe("none");
  });

  it("names who is going with the kind of proof, and links their documents", () => {
    const [e] = eventInsights({
      names,
      events: [
        {
          ...arablab,
          detail: null,
          participants: [
            { brandId: "sciex", evidence: "announced_in_post", documentId: "post9" },
            { brandId: "sciex", evidence: "announced_in_post", documentId: "post10" },
          ],
        },
      ],
      now,
    });
    expect(e.content).toContain("Going: SCIEX (announced it in a post).");
    expect(e.sourceSignalIds).toEqual(["page1", "post9", "post10"]);
    expect(e.confidence).toBe(0.65);
  });

  it("skips past and undated events", () => {
    expect(
      eventInsights({
        names,
        events: [
          { ...arablab, startsOn: "2026-05-31", endsOn: "2026-06-04" },
          { ...arablab, startsOn: null, endsOn: null },
        ],
        now,
      }),
    ).toEqual([]);
  });
});

describe("planInsightWrites", () => {
  const w = (key: string, content: string) => ({ key, content, sourceSignalIds: [], confidence: 0.7 });

  it("leaves unchanged insights alone, replaces changed ones, retires ones that no longer hold", () => {
    const plan = planInsightWrites(
      [w("interest:c:a", "same"), w("interest:c:b", "new number"), w("interest:c:new", "fresh")],
      [
        { id: "1", insightKey: "interest:c:a", content: "same" },
        { id: "2", insightKey: "interest:c:b", content: "old number" },
        { id: "3", insightKey: "interest:c:gone", content: "fell below the gate" },
      ],
    );
    expect(plan.insert.map((i) => i.key)).toEqual(["interest:c:b", "interest:c:new"]);
    expect(plan.supersede.sort()).toEqual(["2", "3"]);
  });
});

describe("writers", () => {
  function fakeDeps(active: { id: string; insightKey: string | null; content: string }[] = []) {
    const inserted: { content: string; embedding?: number[]; insightKey: string }[] = [];
    const superseded: string[] = [];
    const deps: InsightWriterDeps = {
      embed: async (t) => (t.includes("ARABLAB") ? null : [0.1, 0.2]),
      listActive: async (_ws, prefix) => active.filter((a) => a.insightKey?.startsWith(prefix)),
      insert: async (row) => {
        inserted.push(row);
        return `id${inserted.length}`;
      },
      supersede: async (_ws, ids) => {
        superseded.push(...ids);
      },
    };
    return { deps, inserted, superseded };
  }

  it("embeds and stores a client's measured insight, keyed", async () => {
    const f = fakeDeps([{ id: "old", insightKey: "interest:waters:hplc", content: "no longer gated" }]);
    const result = await writeClientInsights(f.deps, {
      workspaceId: "ws",
      client: { id: "waters", name: "Waters" },
      names,
      momentum: [ms()],
      signals: [sig({})],
    });
    expect(result).toMatchObject({ written: 1, superseded: 1, unembedded: 0 });
    expect(f.inserted[0]).toMatchObject({ insightKey: "interest:waters:mass spectrometry", embedding: [0.1, 0.2] });
    expect(f.superseded).toEqual(["old"]);
  });

  it("B1: passes the producer's falsifier/subjectKey/direction through to insert, with kind/writtenBy and a due_at derived from the falsifier's window", async () => {
    const f = fakeDeps();
    const now = new Date("2026-10-13T00:00:00Z");
    await writeClientInsights(f.deps, {
      workspaceId: "ws",
      client: { id: "waters", name: "Waters" },
      names,
      momentum: [ms({ baseline: 0.9, change: 0.34 })],
      signals: [sig({})],
      now,
    });
    expect(f.inserted[0]).toMatchObject({
      kind: "measured",
      writtenBy: "insight-writer-v2",
      falsifier: { metric: "topic_momentum", subject: { topic: "mass spectrometry" }, direction: "below", threshold: 1.0, window_days: 30 },
      subjectKey: "topic:mass spectrometry",
      direction: "up",
      dueAt: new Date(now.getTime() + 30 * 86_400_000),
    });
  });

  it("B1: an event insight (no fitting metric) is still kind='measured'/written_by, but falsifier/subjectKey/direction/dueAt are null/none", async () => {
    const f = fakeDeps();
    await writeEventInsights(f.deps, {
      workspaceId: "ws",
      names,
      now,
      events: [
        {
          eventKey: "arablab-2026",
          name: "ARABLAB LIVE 2026",
          format: "in_person",
          startsOn: "2026-10-26",
          endsOn: "2026-10-28",
          location: "Dubai",
          country: "AE",
          documentId: "p",
          detail: null,
          participants: [],
        },
      ],
    });
    expect(f.inserted[0]).toMatchObject({
      kind: "measured",
      writtenBy: "insight-writer-v2",
      falsifier: null,
      subjectKey: null,
      direction: "none",
      dueAt: null,
    });
  });

  it("stores an event insight without a vector when embedding fails, rather than dropping it", async () => {
    const f = fakeDeps();
    const result = await writeEventInsights(f.deps, {
      workspaceId: "ws",
      names,
      now,
      events: [
        {
          eventKey: "arablab-2026",
          name: "ARABLAB LIVE 2026",
          format: "in_person",
          startsOn: "2026-10-26",
          endsOn: "2026-10-28",
          location: "Dubai",
          country: "AE",
          documentId: "p",
          detail: null,
          participants: [],
        },
      ],
    });
    expect(result).toMatchObject({ written: 1, unembedded: 1 });
    expect(f.inserted[0].embedding).toBeUndefined();
  });
});
