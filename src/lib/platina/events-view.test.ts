import { describe, expect, it } from "vitest";
import { buildRadar, COUNTRY_POINTS, project, type RadarEventInput } from "./events-view";

const NOW = new Date("2026-09-23T10:00:00Z");
const ev = (over: Partial<RadarEventInput>): RadarEventInput => ({
  id: over.name ?? "e",
  eventKey: over.name ?? "e",
  name: "Event",
  format: "in_person",
  startsOn: "2026-10-26",
  endsOn: null,
  dateText: null,
  location: null,
  country: null,
  sourceUrl: "https://example.org/event",
  ...over,
});

const brands = [
  { id: "w", name: "Waters", kind: "own_brand" },
  { id: "b", name: "Bruker", kind: "competitor" },
  { id: "t", name: "Thermo Fisher Scientific", kind: "competitor" },
];

describe("buildRadar (events radar)", () => {
  const radar = buildRadar({
    events: [
      ev({ id: "arab", name: "ARABLAB LIVE 2026", startsOn: "2026-10-26", endsOn: "2026-10-28", location: "Dubai, UAE", country: "AE", sourceUrl: "https://www.terrapinn.com/exhibition/arablab-live/" }),
      ev({ id: "ghe", name: "Global Health Exhibition", startsOn: "2026-10-26", sourceUrl: "https://www.globalhealthsaudi.com/" }),
      ev({ id: "ecs", name: "ECS Fall", startsOn: "2026-10-25", location: "Calgary", country: "CA" }),
      ev({ id: "w1", name: "Waters European Biopharma Analytical Forum (WEBAF)", startsOn: "2026-10-13", country: "MT", sourceUrl: "https://linkedin.com/p/1" }),
      ev({ id: "w2", name: "WEBAF", startsOn: "2026-10-13", country: "MT", sourceUrl: "https://linkedin.com/p/1" }),
      ev({ id: "web", name: "Nanosensors webinar", format: "online", startsOn: "2026-10-09" }),
      ev({ id: "old", name: "Past show", startsOn: "2026-09-01" }),
      ev({ id: "tbd", name: "DUPHAT", startsOn: null, sourceUrl: "https://duphat.ae/" }),
    ],
    participants: [
      { eventId: "arab", brandId: "b", evidence: "listed_exhibitor", sourceUrl: "https://t/list" },
      { eventId: "arab", brandId: "b", evidence: "announced_in_post", sourceUrl: "https://li/b" },
      { eventId: "arab", brandId: "t", evidence: "listed_exhibitor", sourceUrl: "https://t/list" },
      { eventId: "w2", brandId: "w", evidence: "announced_in_post", sourceUrl: "https://linkedin.com/p/1" },
    ],
    brands,
    now: NOW,
  });

  it("puts the Gulf first, then by date, and leaves past events out", () => {
    expect(radar.inPerson.map((e) => e.id)).toEqual(["arab", "ghe", "w1", "ecs"]);
    expect(radar.inPerson.some((e) => e.id === "old")).toBe(false);
  });

  it("gives a conference page with no stated place its calendar home, and says so", () => {
    const ghe = radar.inPerson.find((e) => e.id === "ghe")!;
    expect(ghe).toMatchObject({ country: "SA", place: "Riyadh", placeFromCalendar: true, gulf: true });
    const undated = radar.undated[0];
    expect(undated).toMatchObject({ name: "DUPHAT", country: "AE", gulf: true });
  });

  it("shows one event read under two names once, keeping the other name and its proofs", () => {
    const webaf = radar.inPerson.filter((e) => e.startsOn === "2026-10-13");
    expect(webaf).toHaveLength(1);
    expect(webaf[0].alsoKnownAs).toEqual(["WEBAF"]);
    expect(webaf[0].going).toEqual([expect.objectContaining({ name: "Waters", role: "client" })]);
  });

  it("lists each company once, with how we know", () => {
    const arab = radar.inPerson[0];
    expect(arab.going.map((g) => g.name)).toEqual(["Bruker", "Thermo Fisher Scientific"]);
    expect(arab.going[0].how).toBe("on the exhibitor list");
    expect(arab.daysLeft).toBe(33);
  });

  it("spotlights the next in-person Gulf event and keeps webinars apart", () => {
    expect(radar.spotlight?.id).toBe("arab");
    expect(radar.online.map((e) => e.id)).toEqual(["web"]);
    expect(radar.countries).toEqual(
      expect.arrayContaining([{ country: "AE", events: 1, gulf: true }, { country: "SA", events: 1, gulf: true }]),
    );
  });
});

describe("buildRadar location repairs (live 2026-09-23)", () => {
  it("never borrows a home from another show on the same website, and reads the stated place first", () => {
    const radar = buildRadar({
      events: [
        ev({ id: "milan", name: "CPHI Milan", startsOn: "2026-10-06", location: "Fiera Milano, Italy", sourceUrl: "https://www.cphi.com/europe" }),
        ev({ id: "x", name: "CPHI Sustainability Summit", startsOn: "2026-10-07", sourceUrl: "https://www.cphi.com/europe" }),
        ev({ id: "me", name: "CPHI Middle East", startsOn: "2026-12-14", sourceUrl: "https://www.cphi.com/middle-east" }),
        ev({ id: "ec", name: "Universidad Ecotec", startsOn: "2026-10-29", location: "Samborondón, Ecuador", sourceUrl: "https://www.acs.org/events.html" }),
        ev({ id: "junk", name: "Events", startsOn: "2027-03-21", sourceUrl: "https://www.acs.org/events.html" }),
      ],
      participants: [],
      brands,
      now: NOW,
    });
    const byId = new Map(radar.inPerson.map((e) => [e.id, e]));
    expect(byId.get("milan")).toMatchObject({ country: "IT", gulf: false, placeFromCalendar: false });
    expect(byId.get("x")).toMatchObject({ country: "IT", gulf: false });
    expect(byId.get("me")).toMatchObject({ country: "SA", gulf: true, placeFromCalendar: true });
    expect(byId.get("ec")?.country).not.toBe("US");
    expect(byId.has("junk")).toBe(false);
  });
});

describe("map projection", () => {
  it("places Dubai east of Munich and north of the equator", () => {
    const dubai = project(COUNTRY_POINTS.AE, 1000, 500);
    const munich = project(COUNTRY_POINTS.DE, 1000, 500);
    expect(dubai.x).toBeGreaterThan(munich.x);
    expect(dubai.y).toBeLessThan(250);
  });
});
