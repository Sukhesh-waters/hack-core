/**
 * The Events radar (C7.3 page, C8 showcase). Pure: stored events and their
 * participation proofs -> what the page shows. Gulf first, then by date;
 * online sessions apart from in-person shows; each event with who is going
 * and the proof. No model call and no number that was not stored.
 *
 * Two repairs on read (live 2026-09-23):
 *  - a conference page that never states its city still has a known home:
 *    the calendar entry for that site gives the country (Global Health ->
 *    Riyadh, SA), marked "from the calendar";
 *  - the same event read twice under two names (WEBAF and its full name, same
 *    dates, same post) is shown once.
 */
import { CONFERENCE_CALENDAR } from "./conference-calendar";
import { countryOf, daysUntil, eventTiming, isGcc } from "./events";

export type RadarEventInput = {
  id: string;
  eventKey: string;
  name: string;
  format: string;
  startsOn: string | null;
  endsOn: string | null;
  dateText: string | null;
  location: string | null;
  country: string | null;
  sourceUrl: string;
};

export type RadarParticipant = { eventId: string; brandId: string; evidence: string; sourceUrl: string };

export type RadarEvent = {
  id: string;
  name: string;
  online: boolean;
  startsOn: string | null;
  endsOn: string | null;
  dateText: string | null;
  place: string | null;
  country: string | null;
  /** The country came from the conference calendar, not the page. */
  placeFromCalendar: boolean;
  gulf: boolean;
  daysLeft: number | null;
  sourceUrl: string;
  going: { brandId: string; name: string; role: "client" | "competitor"; how: string; proof: string }[];
  /** Other names the same event was read under. */
  alsoKnownAs: string[];
};

export type Radar = {
  /** The next in-person Gulf event, for the countdown card. */
  spotlight: RadarEvent | null;
  inPerson: RadarEvent[];
  online: RadarEvent[];
  undated: RadarEvent[];
  countries: { country: string; events: number; gulf: boolean }[];
};

const EVIDENCE: Record<string, string> = {
  listed_exhibitor: "on the exhibitor list",
  mentioned_on_event_page: "named on the event page",
  announced_in_post: "announced it in a post",
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * The calendar's home for a page that states no place. Only when exactly one
 * show owns that address: cphi.com is both CPHI Milan and CPHI Middle East
 * (live 2026-09-23 the host alone starred Milan as Gulf), so a shared host
 * needs the page path to match; a show that moves ("varies") has no home.
 */
function calendarHome(sourceUrl: string): { country: string; city: string } | null {
  const host = hostOf(sourceUrl);
  if (!host) return null;
  const sameHost = CONFERENCE_CALENDAR.filter((c) => hostOf(c.url) === host && c.city !== "varies");
  const path = (u: string) => {
    try {
      return new URL(u).pathname.replace(/\/+$/, "");
    } catch {
      return "";
    }
  };
  const show =
    sameHost.length === 1 && CONFERENCE_CALENDAR.filter((c) => hostOf(c.url) === host).length === 1
      ? sameHost[0]
      : sameHost.find((c) => path(c.url).length > 1 && path(sourceUrl).startsWith(path(c.url)));
  return show ? { country: show.country, city: show.city } : null;
}

/** Page headings read as event names ("Events", "Future Dates"): not events. */
const NOT_AN_EVENT = /^(events?|future dates|upcoming events|event calendar|calendar|meetings?|webinars?|home)$/i;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/** "WEBAF" and "Waters European Biopharma Analytical Forum (WEBAF)" on the same dates are one event. */
function sameEvent(a: RadarEventInput, b: RadarEventInput): boolean {
  if (!a.startsOn || a.startsOn !== b.startsOn) return false;
  const [short, long] = a.name.length <= b.name.length ? [a.name, b.name] : [b.name, a.name];
  const w = words(short);
  return w.length > 0 && w.every((x) => words(long).includes(x));
}

export function buildRadar(input: {
  events: RadarEventInput[];
  participants: RadarParticipant[];
  brands: { id: string; name: string; kind: string }[];
  now: Date;
  /** Past events stay out; undated ones are listed for a person to date. */
}): Radar {
  const brandOf = new Map(input.brands.map((b) => [b.id, b]));

  // One row per real event: the longest name wins, the others are kept as aliases.
  const merged: { base: RadarEventInput; ids: string[]; names: string[] }[] = [];
  for (const e of [...input.events].sort((a, b) => b.name.length - a.name.length)) {
    const into = merged.find((m) => sameEvent(m.base, e));
    if (into) {
      into.ids.push(e.id);
      if (!into.names.includes(e.name)) into.names.push(e.name);
    } else merged.push({ base: e, ids: [e.id], names: [e.name] });
  }

  const rows: RadarEvent[] = merged.flatMap(({ base: e, ids, names }) => {
    const timing = eventTiming(e, input.now);
    if (timing === "past" || NOT_AN_EVENT.test(e.name.trim())) return [];
    // Stated country, else the stated place, else (page says nothing) the calendar.
    const stated = e.country ?? countryOf(e.location);
    const home = stated || e.location ? null : calendarHome(e.sourceUrl);
    const country = stated ?? home?.country ?? null;
    const going = new Map<string, RadarEvent["going"][number]>();
    for (const p of input.participants.filter((x) => ids.includes(x.eventId))) {
      const b = brandOf.get(p.brandId);
      if (!b || going.has(b.id)) continue;
      going.set(b.id, {
        brandId: b.id,
        name: b.name,
        role: b.kind === "own_brand" ? "client" : "competitor",
        how: EVIDENCE[p.evidence] ?? p.evidence,
        proof: p.sourceUrl,
      });
    }
    return [
      {
        id: e.id,
        name: e.name,
        online: e.format === "online",
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        dateText: e.dateText,
        place: e.format === "online" ? "online" : (e.location ?? home?.city ?? null),
        country,
        placeFromCalendar: Boolean(home),
        gulf: isGcc(country),
        daysLeft: e.startsOn ? daysUntil(e.startsOn, input.now) : null,
        sourceUrl: e.sourceUrl,
        going: [...going.values()].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "client" ? -1 : 1)),
        alsoKnownAs: names.filter((n) => n !== e.name),
      },
    ];
  });

  const dated = rows.filter((r) => r.startsOn);
  // Same day: the one more competitors are going to first (that is where the audience is).
  const rivals = (r: RadarEvent) => r.going.filter((g) => g.role === "competitor").length;
  const byDate = (a: RadarEvent, b: RadarEvent) =>
    (a.startsOn ?? "").localeCompare(b.startsOn ?? "") || rivals(b) - rivals(a) || a.name.localeCompare(b.name);
  const byGulfThenDate = (a: RadarEvent, b: RadarEvent) => Number(b.gulf) - Number(a.gulf) || byDate(a, b);
  const inPerson = dated.filter((r) => !r.online).sort(byGulfThenDate);
  const online = dated.filter((r) => r.online).sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
  const undated = rows.filter((r) => !r.startsOn).sort((a, b) => Number(b.gulf) - Number(a.gulf) || a.name.localeCompare(b.name));

  const spotlight =
    inPerson
      .filter((r) => r.gulf)
      .sort(byDate)
      .find((r) => (r.daysLeft ?? -1) >= 0) ?? null;

  const counts = new Map<string, number>();
  for (const r of dated) if (r.country && !r.online) counts.set(r.country, (counts.get(r.country) ?? 0) + 1);
  const countries = [...counts.entries()]
    .map(([country, events]) => ({ country, events, gulf: isGcc(country) }))
    .sort((a, b) => b.events - a.events);

  return { spotlight, inPerson, online, undated, countries };
}

/**
 * Where to draw a country on the code-drawn map: [longitude, latitude] of a
 * representative point (capital or main expo city). Countries not listed are
 * named under the map instead of guessed.
 */
export const COUNTRY_POINTS: Record<string, [number, number]> = {
  AE: [55.3, 25.2], SA: [46.7, 24.7], QA: [51.5, 25.3], KW: [48.0, 29.4], OM: [58.4, 23.6], BH: [50.6, 26.2],
  EG: [31.2, 30.0], TR: [29.0, 41.0], IN: [77.2, 28.6], CN: [121.5, 31.2], JP: [140.0, 35.6], KR: [127.0, 37.5],
  SG: [103.8, 1.35], AU: [151.2, -33.9], DE: [8.7, 50.1], GB: [-0.1, 51.5], FR: [2.35, 48.85], IT: [9.2, 45.5],
  ES: [-3.7, 40.4], NL: [4.9, 52.4], CH: [7.4, 46.9], AT: [11.4, 47.3], FI: [24.9, 60.2], SE: [18.1, 59.3],
  MT: [14.5, 35.9], PT: [-9.1, 38.7], BE: [4.35, 50.85], DK: [12.6, 55.7], PL: [21.0, 52.2], US: [-87.6, 41.9], CA: [-73.6, 45.5],
  MX: [-99.1, 19.4], BR: [-46.6, -23.5], EC: [-79.9, -2.2], ZA: [18.4, -33.9],
};

/** Equirectangular projection into a width x height box. */
export function project([lon, lat]: [number, number], width: number, height: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * width, y: ((90 - lat) / 180) * height };
}
