import { describe, expect, it } from "vitest";
import type { TopicMomentum } from "./interest";
import {
  buildCampaigns,
  buildInsights,
  homeCountries,
  MIN_LEAD_DAYS,
  type OpportunityEvent,
  type OpportunityInput,
} from "./opportunities";

const now = new Date("2026-09-21T09:00:00Z");
const at = (d: string) => new Date(`${d}T00:00:00Z`);

const momentum = (over: Partial<TopicMomentum>): TopicMomentum => ({
  topic: "mass spectrometry",
  region: "global",
  signalKind: "interest",
  recent: 1.24,
  baseline: null,
  change: null,
  n: 13,
  status: "ok",
  proofs: [{ sourceUrl: "https://li/sciex-ale", value: 4.18, observedAt: at("2026-09-10") }],
  ...over,
});

const event = (over: Partial<OpportunityEvent>): OpportunityEvent => ({
  id: "e1",
  eventKey: "arablab-2026",
  name: "ARABLAB LIVE 2026",
  format: "in_person",
  startsOn: "2026-10-26",
  endsOn: "2026-10-28",
  dateText: "26-28 October 2026",
  location: "Dubai World Trade Centre",
  country: "AE",
  sourceUrl: "https://www.terrapinn.com/exhibition/arablab-live/",
  detail: { readAt: "2026-09-22T00:10:00Z" },
  participants: [],
  ...over,
});

const base = (over: Partial<OpportunityInput> = {}): OpportunityInput => ({
  client: { id: "waters", name: "Waters", region: "GCC", topics: ["mass spectrometry", "liquid chromatography"] },
  competitors: [
    { id: "sciex", name: "SCIEX" },
    { id: "agilent", name: "Agilent" },
  ],
  momentum: [momentum({})],
  proofOwner: new Map([["https://li/sciex-ale", "sciex"]]),
  events: [],
  now,
  ...over,
});

describe("homeCountries", () => {
  it("reads GCC, a country code, or nothing", () => {
    expect(homeCountries("GCC")).toContain("SA");
    expect(homeCountries("ae")).toEqual(["AE"]);
    expect(homeCountries("Worldwide")).toEqual([]);
    expect(homeCountries(null)).toEqual([]);
  });
});

describe("buildInsights", () => {
  it("states the measured index with its proofs, naming whose post it was", () => {
    const [insight] = buildInsights(base());
    expect(insight).toMatchObject({ topic: "mass spectrometry", origin: "client_topic", status: "ok", n: 13 });
    expect(insight.headline).toContain("1.24×");
    expect(insight.proofs[0]).toEqual({ label: "SCIEX, 2026-09-10: 4.18× its typical post", url: "https://li/sciex-ale" });
  });

  it("says up or down only when there is a before to compare with", () => {
    const [insight] = buildInsights(base({ momentum: [momentum({ recent: 1.5, baseline: 1.1, change: 0.4 })] }));
    expect(insight.headline).toContain("up from 1.1×");
  });

  it("never scores a topic below the min-N gate, and ranks it after measured ones", () => {
    const insights = buildInsights(
      base({ momentum: [momentum({ topic: "glp-1 development", status: "insufficient", n: 1, recent: 3.2 }), momentum({})] }),
    );
    expect(insights.map((i) => i.status)).toEqual(["ok", "insufficient"]);
    expect(insights[1]).toMatchObject({ origin: "market_theme" });
    expect(insights[1].headline).not.toContain("3.2");
    expect(insights[1].headline).toContain("not enough");
  });

  it("keeps competitor pressure out of interest", () => {
    expect(buildInsights(base({ momentum: [momentum({ signalKind: "pressure" })] }))).toEqual([]);
  });
});

describe("buildCampaigns — topics", () => {
  it("proposes an online campaign only for a gated topic above typical engagement", () => {
    const { topics } = buildCampaigns(
      base({
        momentum: [
          momentum({}),
          momentum({ topic: "hplc", recent: 0.8 }),
          momentum({ topic: "glp-1 development", status: "insufficient", n: 2, recent: 5 }),
        ],
      }),
    );
    expect(topics.map((t) => t.key)).toEqual(["topic:mass spectrometry"]);
    expect(topics[0].plan).toEqual({ useCase: "client", goal: expect.stringContaining("1.24x") });
    expect((topics[0].plan as { goal: string }).goal.length).toBeLessThanOrEqual(200);
    expect(topics[0].why.join(" ")).toContain("SCIEX's");
  });

  it("adds competitor ad pressure on the same topic as a proof", () => {
    const { topics } = buildCampaigns(
      base({
        momentum: [
          momentum({}),
          momentum({
            signalKind: "pressure",
            region: "AE",
            proofs: [{ sourceUrl: "https://ads/1", value: 64, observedAt: at("2026-07-19") }],
          }),
        ],
      }),
    );
    expect(topics[0].proofs).toContainEqual({ label: "ad running 64 days", url: "https://ads/1" });
    expect(topics[0].why.join(" ")).toContain("in AE");
  });
});

describe("buildCampaigns — events", () => {
  it("ranks lead time, then home region, then competitors present", () => {
    const { events } = buildCampaigns(
      base({
        events: [
          event({ id: "soon", eventKey: "webinar-2026", name: "PFAS webinar", format: "online", startsOn: "2026-09-25", endsOn: "2026-09-25", country: null, location: null }),
          event({ id: "far", eventKey: "pittcon-2027", name: "Pittcon", startsOn: "2027-04-24", endsOn: "2027-04-28", country: "US", location: "Pittsburgh, PA" , participants: [
            { brandId: "agilent", evidence: "listed_exhibitor", sourceUrl: "https://pittcon.org/exhibitors" },
          ]}),
          event({}),
          event({ id: "past", eventKey: "asms-2026", name: "ASMS", startsOn: "2026-05-31", endsOn: "2026-06-04", country: "US" }),
        ],
      }),
    );
    expect(events.map((e) => e.key)).toEqual(["event:arablab-2026", "event:pittcon-2027", "event:webinar-2026"]);
    expect(events[0].why.join(" ")).toContain("region (AE)");
    expect(events[0].why.join(" ")).toContain("No competitor named on the event page read 2026-09-22");
    expect(events[1].proofs).toContainEqual({ label: "Agilent on the exhibitor list", url: "https://pittcon.org/exhibitors" });
    expect(events[2]).toMatchObject({ channel: "online", timing: "short notice: in 4 days" });
  });

  it("hands the planner the event and its date", () => {
    const { events } = buildCampaigns(base({ events: [event({})] }));
    expect(events[0].plan).toEqual({ useCase: "event", eventName: "ARABLAB LIVE 2026", eventDate: "2026-10-26" });
    expect(events[0].timing).toBe("in 35 days");
    expect(35).toBeGreaterThanOrEqual(MIN_LEAD_DAYS);
  });

  it("says when the client is already going, and never counts the client as a rival", () => {
    const { events } = buildCampaigns(
      base({
        events: [
          event({
            participants: [{ brandId: "waters", evidence: "announced_in_post", sourceUrl: "https://li/waters" }],
          }),
        ],
      }),
    );
    expect(events[0].why.join(" ")).toContain("Waters is already going");
    expect(events[0].why.join(" ")).not.toContain("are going");
  });

  it("does not claim an absence it never checked", () => {
    const { events } = buildCampaigns(base({ events: [event({ detail: null })] }));
    expect(events[0].why.join(" ")).not.toContain("No competitor named");
  });
});

describe("whose event is it", () => {
  it("finds the host by full name or first word", async () => {
    const { hostOf } = await import("./opportunities");
    const brands = [
      { id: "sciex", name: "SCIEX" },
      { id: "thermo", name: "Thermo Fisher Scientific" },
      { id: "waters", name: "Waters" },
    ];
    expect(hostOf("SCIEX summit 2026", brands)).toBe("sciex");
    expect(hostOf("Thermo Fisher World Tour", brands)).toBe("thermo");
    expect(hostOf("Waters Inform User Meeting", brands)).toBe("waters");
    expect(hostOf("ARABLAB LIVE 2026", brands)).toBeNull();
  });

  it("turns a competitor's own event into an online counter, ranked after joinable events", () => {
    const { events } = buildCampaigns(
      base({
        events: [
          event({ id: "s", eventKey: "sciex-summit-2026", name: "SCIEX summit 2026", startsOn: "2026-10-13", endsOn: "2026-10-14", country: "DE", location: "Darmstadt", participants: [
            { brandId: "sciex", evidence: "announced_in_post", sourceUrl: "https://li/sciex" },
          ]}),
          event({}),
        ],
      }),
    );
    expect(events.map((e) => e.key)).toEqual(["event:arablab-2026", "event:sciex-summit-2026"]);
    expect(events[1]).toMatchObject({ channel: "online", title: "Counter SCIEX summit 2026 — online" });
    expect(events[1].why.join(" ")).toContain("SCIEX's own event");
    expect(events[1].why.join(" ")).not.toContain("audience you compete for will be there");
    expect(events[1].plan).toEqual({ useCase: "client", goal: expect.stringContaining("timed to SCIEX summit 2026") });
  });

  it("does not show a number for a topic below the gate", () => {
    const [thin] = buildInsights(base({ momentum: [momentum({ status: "insufficient", n: 1, recent: 2.16 })] }));
    expect(thin.proofs).toEqual([{ label: "example post", url: "https://li/sciex-ale" }]);
  });
});
