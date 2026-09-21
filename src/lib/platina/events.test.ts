import { describe, expect, it } from "vitest";
import {
  brandsOnEventPage,
  countryOf,
  daysUntil,
  eventKey,
  eventTiming,
  findDateRanges,
  isGcc,
  parseDateRange,
  quotedIn,
  sameEvent,
} from "./events";

describe("findDateRanges — the formats on the live event pages (2026-09-21)", () => {
  it.each([
    ["#### **26-28 October 2026**   Dubai World Trade Centre", "2026-10-26", "2026-10-28"], // Arablab
    ["April 24-28, 2027 \\| Pittsburgh, PA, USA", "2027-04-24", "2027-04-28"], // Pittcon
    ["#### May 31 - June 4, 2026 \\| Short Courses May 30 & 31", "2026-05-31", "2026-06-04"], // ASMS
    ["Oct 25–27, 2026  Manhattan, KS", "2026-10-25", "2026-10-27"], // ACS regional
    ["March 21-25, 2027  New Orleans, LA", "2027-03-21", "2027-03-25"], // ACS spring
    ["from June 20-24, 2027, in Innsbruck", "2027-06-20", "2027-06-24"], // HPLC 2027
    ["held 30 May - 4 June 2026", "2026-05-30", "2026-06-04"],
    ["MARCH 27, 2026", "2026-03-27", "2026-03-27"],
  ])("%s", (text, startsOn, endsOn) => {
    expect(parseDateRange(text)).toMatchObject({ startsOn, endsOn });
  });

  it("finds every range on a listing page, in reading order", () => {
    const text = "Spring 2027 March 21-25, 2027 New Orleans\n2026 Midwest Regional Meeting Oct 25–27, 2026 Manhattan, KS";
    expect(findDateRanges(text).map((r) => r.startsOn)).toEqual(["2027-03-21", "2026-10-25"]);
  });

  it("dates a year-less post mention from the post's own date", () => {
    const posted = new Date("2026-09-10T00:00:00Z");
    expect(parseDateRange("Join us for this symposium on September 22–23", posted)).toMatchObject({
      startsOn: "2026-09-22",
      endsOn: "2026-09-23",
    });
    // April, written in a September post, is next April.
    expect(parseDateRange("Join us April 12-14 in Milford", posted)?.startsOn).toBe("2027-04-12");
    expect(parseDateRange("Sept 22nd, 10AM EDT", posted)?.startsOn).toBe("2026-09-22");
  });

  it("drops a year-less date with nothing to anchor it, and impossible dates", () => {
    expect(parseDateRange("Join us April 12-14")).toBeNull();
    expect(parseDateRange("February 30, 2027")).toBeNull();
    expect(parseDateRange("January 1 - December 31, 2027")).toBeNull(); // not an event
  });
});

describe("quotedIn", () => {
  it("accepts the model's quote only when the words are really on the page", () => {
    const page = "#### **26-28 October 2026**   Dubai World Trade Centre";
    expect(quotedIn("26-28 October 2026", page)).toBe(true);
    expect(quotedIn("26–28 October 2026", page)).toBe(true); // dash style is not a difference
    expect(quotedIn("27-29 October 2026", page)).toBe(false);
    expect(quotedIn("ok", page)).toBe(false);
  });
});

describe("countryOf / isGcc", () => {
  it.each([
    ["Dubai World Trade Centre", "AE"],
    ["Pittsburgh, PA, USA", "US"],
    ["Manhattan, KS", "US"],
    ["Munich", "DE"],
    ["Genome Valley, Hyderabad", "IN"],
    ["Innsbruck, Austria", "AT"],
    ["Riyadh Front Exhibition Centre", "SA"],
  ])("%s -> %s", (place, code) => {
    expect(countryOf(place)).toBe(code);
  });

  it("says nothing when the place is unknown", () => {
    expect(countryOf("Online")).toBeNull();
    expect(countryOf(null)).toBeNull();
  });

  it("knows the Gulf", () => {
    expect(isGcc("AE")).toBe(true);
    expect(isGcc("DE")).toBe(false);
    expect(isGcc(null)).toBe(false);
  });
});

describe("event identity", () => {
  it("keys an event by its significant words and year", () => {
    expect(eventKey("ARABLAB LIVE 2026", 2026)).toBe("arablab-2026");
    expect(eventKey("Pittcon 2027 Conference + Expo", 2027)).toBe("pittcon-2027");
    expect(eventKey("74th ASMS Conference", null)).toBe("asms-tba");
  });

  it("merges the same event seen under different names", () => {
    expect(
      sameEvent(
        { name: "ASMS", year: 2027, country: "US" },
        { name: "ASMS Conference on Mass Spectrometry and Allied Topics", year: 2027, country: null },
      ),
    ).toBe(true);
    expect(
      sameEvent({ name: "SOFT/TIAFT Joint Meeting", year: 2026, country: null }, { name: "SOFT TIAFT", year: 2026, country: "US" }),
    ).toBe(true);
  });

  it("keeps different events apart: other year, other country, other name", () => {
    expect(sameEvent({ name: "analytica", year: 2026, country: "DE" }, { name: "Analytica Lab Expo", year: 2026, country: "IN" })).toBe(false);
    expect(sameEvent({ name: "Pittcon", year: 2026, country: "US" }, { name: "Pittcon", year: 2027, country: "US" })).toBe(false);
    expect(sameEvent({ name: "ASMS", year: 2027, country: null }, { name: "HPLC", year: 2027, country: null })).toBe(false);
  });
});

describe("brandsOnEventPage", () => {
  const brands = [
    { id: "w", name: "Waters" },
    { id: "t", name: "Thermo Fisher Scientific" },
    { id: "a", name: "Agilent" },
  ];

  it("reads Terrapinn's captioned logos as a listing", () => {
    const md =
      "## 2026 Sponsors & Exhibitors\n[![Agilent at ARABLAB LIVE 2026](https://cdn/x.png)](https://x/sponsor-agilent.stm)";
    expect(brandsOnEventPage({ url: "https://www.terrapinn.com/exhibition/arablab-live/", markdown: md }, brands)).toEqual([
      expect.objectContaining({ brandId: "a", evidence: "listed_exhibitor" }),
    ]);
  });

  it("treats a name on an exhibitor page as listed, elsewhere as a mention", () => {
    const md = "Keynote by a Thermo Fisher Scientific fellow.";
    expect(brandsOnEventPage({ url: "https://asms.org/exhibitors/corporate-members-2026", markdown: md }, brands)[0].evidence).toBe(
      "listed_exhibitor",
    );
    expect(brandsOnEventPage({ url: "https://asms.org/program", markdown: md }, brands)[0].evidence).toBe(
      "mentioned_on_event_page",
    );
  });

  it("does not read the river for the company", () => {
    const md = "Cruise the waters of the Gulf; WatersEdge Ltd exhibits too.";
    expect(brandsOnEventPage({ url: "https://x/exhibitors", markdown: md }, brands)).toEqual([]);
  });
});

describe("timing", () => {
  const now = new Date("2026-09-21T09:00:00Z");
  it("upcoming, happening, past, undated", () => {
    expect(eventTiming({ startsOn: "2026-10-26", endsOn: "2026-10-28" }, now)).toBe("upcoming");
    expect(eventTiming({ startsOn: "2026-09-20", endsOn: "2026-09-23" }, now)).toBe("happening");
    expect(eventTiming({ startsOn: "2026-05-31", endsOn: "2026-06-04" }, now)).toBe("past");
    expect(eventTiming({ startsOn: null, endsOn: null }, now)).toBe("undated");
  });

  it("counts whole days to the first day", () => {
    expect(daysUntil("2026-10-26", now)).toBe(35);
  });
});
