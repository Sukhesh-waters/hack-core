import { describe, expect, it } from "vitest";
import { buildBriefPrompt, ownPassages, parseBrief, publicFacts, searchWords } from "./opportunity-brief";
import type { Campaign } from "./opportunities";

const campaign: Campaign = {
  key: "event:arablab-2026",
  channel: "in_person",
  source: "event",
  title: "ARABLAB LIVE 2026 — Dubai, UAE",
  why: ["In Waters's region (AE).", "Bruker, Shimadzu are going — the audience you compete for will be there."],
  proofs: [{ label: '"26-28 October 2026"', url: "https://www.terrapinn.com/exhibition/arablab-live/" }],
  timing: "in 33 days",
  plan: { useCase: "event", eventName: "ARABLAB LIVE 2026", eventDate: "2026-10-26" },
  creativeTopic: "Waters at ARABLAB LIVE 2026",
  place: "Dubai, UAE",
  dates: "26-28 October 2026",
  startBy: "now",
  factors: [],
};

const facts = publicFacts(campaign);
const own = ownPassages([
  { content: "Xevo TQ Absolute: the most sensitive tandem quadrupole for PFAS in drinking water.", sourceUrl: "https://www.waters.com/xevo" },
]);

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    goal: "Book demos with Gulf water-testing labs at ARABLAB.",
    audience: "Lab managers in UAE and Saudi water and food labs",
    whyNow: [{ text: "ARABLAB runs 26-28 October 2026 in Dubai with Bruker and Shimadzu present.", cites: ["F2", "F3", "F4"] }],
    fit: [{ text: "Xevo TQ Absolute answers PFAS testing in drinking water.", cites: ["A1"] }],
    salesAngle: { text: "Lead with PFAS sensitivity in drinking water.", cites: ["A1"] },
    steps: [{ when: "week 1", what: "Book meetings" }],
    ...over,
  });

describe("opportunity brief (C8.4)", () => {
  it("labels public facts F and own pages A, and keeps them in separate prompt lists", () => {
    expect(facts.map((f) => f.id)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    expect(facts.every((f) => f.plane === "B")).toBe(true);
    expect(own[0]).toMatchObject({ id: "A1", plane: "A" });
    const prompt = buildBriefPrompt({ clientName: "Waters", campaign, facts, own });
    const [, publicBlock, ownBlock] = prompt.split("\n\n");
    expect(publicBlock).toContain("[F1]");
    expect(publicBlock).not.toContain("[A1]");
    expect(ownBlock).toContain("[A1] Xevo");
  });

  it("keeps a well-cited brief", () => {
    const brief = parseBrief(reply(), facts, own);
    expect(brief.whyNow).toHaveLength(1);
    expect(brief.fit[0].cites[0].plane).toBe("A");
    expect(brief.salesAngle?.text).toContain("PFAS");
    expect(brief.dropped).toBe(0);
  });

  it("drops a 'why now' line that cites the client's own pages (two-layer rule)", () => {
    const brief = parseBrief(
      reply({ whyNow: [{ text: "ARABLAB runs 26-28 October 2026.", cites: ["F4"] }, { text: "Our Xevo is the best for this.", cites: ["A1"] }] }),
      facts,
      own,
    );
    expect(brief.whyNow).toHaveLength(1);
    expect(brief.dropped).toBe(1);
  });

  it("drops a fit line citing public facts, and an invented number", () => {
    const brief = parseBrief(
      reply({
        fit: [
          { text: "Bruker is going, so we should too.", cites: ["F2"] },
          { text: "Xevo TQ Absolute is 40% more sensitive for PFAS.", cites: ["A1"] },
        ],
      }),
      facts,
      own,
    );
    expect(brief.fit).toEqual([]);
    expect(brief.dropped).toBe(2);
  });

  it("refuses the whole brief when no 'why now' line is supported", () => {
    expect(() => parseBrief(reply({ whyNow: [{ text: "Everyone will be there, trust us.", cites: [] }] }), facts, own)).toThrow(
      /why now/,
    );
  });

  it("searches the client's pages by what the show is about, never by the client's name (live 2026-09-23)", () => {
    const words = searchWords(campaign, "Waters", ["pfas testing", "waters"]);
    expect(words).toEqual(expect.arrayContaining(["chromatography", "mass spectrometry", "pfas testing"]));
    expect(words).not.toContain("waters");
  });

  it("shows cited ids as labels, not in the text, and drops an uncited number in the goal", () => {
    const brief = parseBrief(
      reply({ goal: "Secure at least 10 qualified leads.", whyNow: [{ text: "ARABLAB runs 26-28 October 2026. F4, F5", cites: ["F4", "F5"] }] }),
      facts,
      own,
    );
    expect(brief.whyNow[0].text).toBe("ARABLAB runs 26-28 October 2026.");
    expect(brief.goal).toBe("");
  });

  it("removes ids from steps and skips investor pages as own evidence (live 2026-09-23)", () => {
    const brief = parseBrief(
      reply({
        steps: [
          { when: "week 6", what: "Train staff on HPLC-MS solutions using A-ids A1, A3, A4 as reference." },
          { when: "week 4", what: "Email key accounts about the HDMS advantage (A2)." },
        ],
      }),
      facts,
      own,
    );
    expect(brief.steps.map((s) => s.what)).toEqual([
      "Train staff on HPLC-MS solutions.",
      "Email key accounts about the HDMS advantage.",
    ]);
    expect(ownPassages([{ content: "Waters Corporation Reports Second Quarter 2023 Financial Results", sourceUrl: null }])).toEqual([]);
  });
});
