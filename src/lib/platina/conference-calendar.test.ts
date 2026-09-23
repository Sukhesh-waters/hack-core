import { describe, expect, it } from "vitest";
import { CONFERENCE_CALENDAR, calendarShows } from "./conference-calendar";
import { isGcc } from "./events";

const LISTING_SITES = /10times|tradefairdates|eventseye|showsbee|emedevents|travel2fair|expobeds|mass-spec-capital/i;

describe("conference calendar (C8.0 F0.4)", () => {
  it("every show has an https official page, a region, a country and topics", () => {
    for (const show of CONFERENCE_CALENDAR) {
      const url = new URL(show.url);
      expect(url.protocol, show.key).toBe("https:");
      expect(LISTING_SITES.test(url.hostname), `${show.key} points at a listing site`).toBe(false);
      expect(show.country, show.key).toMatch(/^[A-Z]{2}$/);
      expect(show.topics.length, show.key).toBeGreaterThan(0);
    }
  });

  it("keys and URLs are unique", () => {
    expect(new Set(CONFERENCE_CALENDAR.map((s) => s.key)).size).toBe(CONFERENCE_CALENDAR.length);
    expect(new Set(CONFERENCE_CALENDAR.map((s) => s.url)).size).toBe(CONFERENCE_CALENDAR.length);
  });

  it("gcc shows are in GCC countries, and they come first", () => {
    const shows = calendarShows();
    const firstNonGulf = shows.findIndex((s) => s.region !== "gcc");
    expect(shows.slice(0, firstNonGulf).every((s) => isGcc(s.country))).toBe(true);
    expect(shows.slice(firstNonGulf).some((s) => s.region === "gcc")).toBe(false);
    expect(shows[0].key).toBe("arablab");
  });

  it("filters by region", () => {
    expect(calendarShows(["gcc"]).map((s) => s.key)).toEqual([
      "arablab",
      "global-health",
      "cphi-middle-east",
      "whx-labs",
      "duphat",
    ]);
  });

  it("holds no dates: dates come only from the official page, with a quote", () => {
    const text = JSON.stringify(CONFERENCE_CALENDAR);
    expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(text).not.toMatch(/\b\d{1,2}\s*[-–]\s*\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
  });
});
