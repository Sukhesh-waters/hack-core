import { describe, expect, it } from "vitest";
import type { AdDetection } from "./ads-view";
import { buildIdeaPrompt, EXPLORE_PER_RUN, findTriggers, labelEvidence, parseIdeas } from "./idea-engine";
import type { Campaign } from "./opportunities";

const event: Campaign = {
  key: "event:arablab-live-2026",
  channel: "in_person",
  source: "event",
  title: "ARABLAB LIVE 2026",
  why: ["Bruker and Shimadzu are on the exhibitor list."],
  proofs: [{ label: "Exhibitor list", url: "https://www.arablab.com/exhibitors" }],
  timing: "in 32 days",
  plan: { useCase: "event", eventName: "ARABLAB LIVE 2026", eventDate: "2026-10-26" },
  creativeTopic: "pfas analysis",
  place: "Dubai, AE",
  dates: "26-28 Oct 2026",
  startBy: "now",
  factors: [],
};
const push: AdDetection = {
  key: "push:b:digital workflows",
  kind: "push",
  brandId: "b",
  title: "Bruker is pushing digital workflows",
  detail: "Bruker started 8 ads on digital workflows in the last 30 days.",
  n: 8,
  proofs: [{ label: "Bruker, from 2026-09-02", url: "https://www.linkedin.com/ad-library/detail/1", docId: "d1" }],
};

describe("findTriggers (C8.5 idea engine)", () => {
  it("ranks a Gulf event first, then an ad push; a far event is not a trigger", () => {
    const far = { ...event, key: "event:far", timing: "in 200 days" };
    const t = findTriggers({ events: [event, far], topics: [], adDetections: [push], regionCodes: ["AE", "SA"] });
    expect(t.map((x) => x.kind)).toEqual(["event", "ad_push"]);
    expect(t[1]).toMatchObject({ key: "trigger:ads:push:b:digital workflows", topic: "digital workflows" });
    expect(t[0].facts.map((f) => f.text)).toContain("Dates: 26-28 Oct 2026");
  });
});

describe("parseIdeas", () => {
  const trigger = findTriggers({ events: [event], topics: [], adDetections: [], regionCodes: ["AE"] })[0];
  const ev = labelEvidence(
    trigger,
    [{ content: "Waters PFAS analysis workflows with the Xevo TQ Absolute for 40 compounds.", sourceUrl: "https://www.waters.com/pfas" }],
    [{ text: "Waters' posts on pfas analysis usually beat its typical post: 4 of 5 (public data)", ref: "pattern:public:topic:pfas analysis" }],
  );
  const idea = (over: Record<string, unknown>) => ({
    title: "PFAS at ARABLAB",
    channel: "event",
    format: "booth",
    hook: "Meet the PFAS team in Dubai",
    why: [{ text: "Competitors will be there in force.", cites: ["F1"] }],
    fit: { text: "The Xevo TQ Absolute covers 40 PFAS compounds.", cites: ["A1"] },
    pattern: { text: "PFAS posts beat the usual post.", cites: ["P1"] },
    explore: false,
    ...over,
  });

  it("builds a prompt with three separate lists and the explore share", () => {
    const p = buildIdeaPrompt({ clientName: "Waters", trigger, ...ev });
    expect(p).toContain("[F1]");
    expect(p).toContain("[A1]");
    expect(p).toContain("[P1]");
    expect(p).toContain(`exactly ${EXPLORE_PER_RUN} tries something new`);

    const withCounter = buildIdeaPrompt({
      clientName: "Waters",
      trigger,
      ...ev,
      counter: "Earlier PFAS booth activation in Dubai drew fewer demos than expected.",
    });
    expect(withCounter).toContain("COUNTER-EVIDENCE (may contradict the above):");
    expect(withCounter).toContain("Earlier PFAS booth activation in Dubai drew fewer demos than expected.");
  });

  it("keeps cited ideas and drops wrong-list, uncited or invented-number ones", () => {
    const raw = JSON.stringify({
      ideas: [
        idea({}),
        idea({ title: "Mixed lists", why: [{ text: "Our own page says so.", cites: ["A1"] }] }),
        idea({ title: "Fit without own page", fit: { text: "Fits well.", cites: ["F1"] } }),
        idea({ title: "Invented", fit: { text: "Covers 99 compounds.", cites: ["A1"] } }),
        idea({ title: "New angle", explore: true, pattern: null }),
        idea({ title: "Second explore", explore: true, pattern: null }),
      ],
    });
    const { ideas, dropped } = parseIdeas(raw, ev);
    expect(ideas.map((i) => i.title)).toEqual(["PFAS at ARABLAB", "New angle"]);
    expect(ideas[1].explore).toBe(true);
    expect(ideas[0].fit?.cites[0].url).toBe("https://www.waters.com/pfas");
    expect(dropped.map((d) => d.title)).toEqual(["Mixed lists", "Fit without own page", "Invented", "Second explore"]);
    expect(dropped[3].why).toContain("cited none");
  });
});
