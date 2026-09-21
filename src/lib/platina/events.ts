/**
 * Events (campaign intelligence C4) — pure. Where the audience physically or
 * virtually gathers, when, and which of the client's competitors are there.
 *
 * Rules, each from the live reads of 2026-09-21:
 *
 *  1. A date is a fact on a page, never a model's guess. The model may point
 *     at the words ("26-28 October 2026"); this file checks those words are
 *     really in the page and turns them into dates.
 *  2. Event pages mostly describe the LAST edition (ASMS 2026 and analytica
 *     2026 were already over when read). Upcoming vs. past is decided here,
 *     from parsed dates, never assumed from "this is a conference page".
 *  3. "Is a competitor exhibiting?" needs a named proof: its name on the
 *     event's exhibitor list, on the event page, or its own post announcing
 *     it. Absence from a list is reported as "not on the list read on <date>",
 *     never as "not exhibiting".
 */

const DAY = 86_400_000;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const D = "(\\d{1,2})(?:st|nd|rd|th)?";
const DASH = "\\s*(?:-|–|—|to|until)\\s*";
const YEAR = "(20\\d{2})";

export type DateRange = { startsOn: string; endsOn: string; text: string; index: number };

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function valid(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const mon = (s: string) => MONTHS[s.toLowerCase().replace(/\.$/, "")];

/** Patterns, most specific first; each reads [month1, day1, year|null, month2, day2]. */
const PATTERNS: { re: RegExp; read: (m: RegExpExecArray) => [number, number, number | null, number, number] }[] = [
  // "May 31 - June 4, 2026"
  {
    re: new RegExp(`\\b${MONTH}\\s+${D}${DASH}${MONTH}\\s+${D},?\\s+${YEAR}`, "gi"),
    read: (m) => [mon(m[1]), +m[2], +m[5], mon(m[3]), +m[4]],
  },
  // "30 May - 4 June 2026"
  {
    re: new RegExp(`\\b${D}\\s+${MONTH}${DASH}${D}\\s+${MONTH},?\\s+${YEAR}`, "gi"),
    read: (m) => [mon(m[2]), +m[1], +m[5], mon(m[4]), +m[3]],
  },
  // "April 24-28, 2027", "Oct 25–27, 2026"
  {
    re: new RegExp(`\\b${MONTH}\\s+${D}${DASH}${D},?\\s+${YEAR}`, "gi"),
    read: (m) => [mon(m[1]), +m[2], +m[4], mon(m[1]), +m[3]],
  },
  // "26-28 October 2026"
  {
    re: new RegExp(`\\b${D}${DASH}${D}\\s+${MONTH},?\\s+${YEAR}`, "gi"),
    read: (m) => [mon(m[3]), +m[1], +m[4], mon(m[3]), +m[2]],
  },
  // "March 21, 2027"
  {
    re: new RegExp(`\\b${MONTH}\\s+${D},?\\s+${YEAR}`, "gi"),
    read: (m) => [mon(m[1]), +m[2], +m[3], mon(m[1]), +m[2]],
  },
  // "21 March 2027"
  {
    re: new RegExp(`\\b${D}\\s+${MONTH},?\\s+${YEAR}`, "gi"),
    read: (m) => [mon(m[2]), +m[1], +m[3], mon(m[2]), +m[1]],
  },
  // Year-less, as posts write them: "September 22–23", "April 12-14", "Sept 22nd"
  {
    re: new RegExp(`\\b${MONTH}\\s+${D}(?:${DASH}${D})?\\b`, "gi"),
    read: (m) => [mon(m[1]), +m[2], null, mon(m[1]), m[3] ? +m[3] : +m[2]],
  },
  // "22 September", "26-28 October"
  {
    re: new RegExp(`\\b${D}(?:${DASH}${D})?\\s+${MONTH}\\b`, "gi"),
    read: (m) => [mon(m[3]), +m[1], null, mon(m[3]), m[2] ? +m[2] : +m[1]],
  },
];

/**
 * Every date or date range written in `text`, in reading order. A range with
 * no year (a post saying "Join us April 12-14") takes the first year that puts
 * it no more than 30 days before `reference` — the post's own date — and is
 * dropped when there is no reference.
 */
export function findDateRanges(text: string, reference?: Date): DateRange[] {
  const taken: [number, number][] = [];
  const out: DateRange[] = [];
  for (const { re, read } of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const [m1, d1, y, m2, d2] = read(m);
      if (!m1 || !m2) continue;
      let year = y;
      if (year === null) {
        if (!reference) continue;
        year = reference.getUTCFullYear();
        if (Date.UTC(year, m1 - 1, d1) < reference.getTime() - 30 * DAY) year += 1;
      }
      // A range that crosses New Year ("Dec 30 - Jan 2, 2027") starts the year before.
      const y1 = m2 < m1 ? year - 1 : year;
      if (!valid(y1, m1, d1) || !valid(year, m2, d2)) continue;
      const startsOn = iso(y1, m1, d1);
      const endsOn = iso(year, m2, d2);
      taken.push([start, end]);
      // Too long to be an event ("January 1 - December 31"): consumed, not
      // re-read as its last day.
      if (endsOn < startsOn) continue;
      if (Date.UTC(year, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1) > 31 * DAY) continue;
      out.push({ startsOn, endsOn, text: m[0].trim(), index: start });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The first date range in a short piece of text (a model's quoted words). */
export function parseDateRange(text: string, reference?: Date): DateRange | null {
  return findDateRanges(text, reference)[0] ?? null;
}

const normalised = (s: string) =>
  s
    .toLowerCase()
    .replace(/\\([|*_`#[\]()])/g, "$1")
    .replace(/[*_`|#]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Whitespace/markup-insensitive "are these words really on the page?". */
export function quotedIn(quote: string, source: string): boolean {
  const q = normalised(quote);
  return q.length >= 3 && normalised(source).includes(q);
}

// ---------------------------------------------------------------------------
// Where
// ---------------------------------------------------------------------------

export const GCC_COUNTRIES = ["AE", "SA", "QA", "KW", "OM", "BH"] as const;

/** Cities and countries seen on laboratory-science event pages. */
const PLACES: [RegExp, string][] = [
  [/\b(dubai|abu dhabi|sharjah|uae|united arab emirates|emirates)\b/i, "AE"],
  [/\b(riyadh|jeddah|dammam|khobar|saudi arabia|ksa)\b/i, "SA"],
  [/\b(doha|qatar)\b/i, "QA"],
  [/\b(kuwait)\b/i, "KW"],
  [/\b(muscat|oman)\b/i, "OM"],
  [/\b(manama|bahrain)\b/i, "BH"],
  [/\b(cairo|egypt)\b/i, "EG"],
  [/\b(munich|münchen|berlin|frankfurt|darmstadt|germany)\b/i, "DE"],
  [/\b(innsbruck|vienna|austria)\b/i, "AT"],
  [/\b(london|manchester|united kingdom)\b/i, "GB"],
  [/\b(paris|lyon|france)\b/i, "FR"],
  [/\b(barcelona|madrid|spain)\b/i, "ES"],
  [/\b(amsterdam|netherlands)\b/i, "NL"],
  [/\b(bruges|brussels|belgium)\b/i, "BE"],
  [/\b(hyderabad|mumbai|bengaluru|bangalore|delhi|chennai|india)\b/i, "IN"],
  [/\b(shanghai|beijing|china)\b/i, "CN"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(tokyo|chiba|japan)\b/i, "JP"],
  [/\b(sydney|melbourne|australia)\b/i, "AU"],
  [/\b(toronto|montreal|canada)\b/i, "CA"],
  [
    /\b(usa|u\.s\.a?\.?|united states|pittsburgh|chicago|boston|san diego|new orleans|baltimore|indianapolis|denver|atlanta|philadelphia|anaheim|manhattan, ks)\b|,\s*(pa|ma|ca|il|la|md|in|co|ga|ks|tx|ny|fl|wa|nc|oh|mn|az|ut)\b/i,
    "US",
  ],
];

/** ISO country of a free-text location, or null when it does not say. */
export function countryOf(location: string | null | undefined): string | null {
  if (!location) return null;
  for (const [re, code] of PLACES) if (re.test(location)) return code;
  return null;
}

export function isGcc(country: string | null | undefined): boolean {
  return Boolean(country && (GCC_COUNTRIES as readonly string[]).includes(country));
}

// ---------------------------------------------------------------------------
// Which event is this? (the same event seen on its page and in three posts)
// ---------------------------------------------------------------------------

const NAME_STOPWORDS = new Set([
  "the", "of", "on", "and", "for", "in", "at", "an", "annual", "international", "conference",
  "conferences", "expo", "exposition", "exhibition", "live", "meeting", "joint", "symposium",
  "summit", "congress", "show", "fair", "trade", "edition", "event", "series", "homepage",
]);

/** Significant words of an event name: no years, ordinals, filler. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\b\d+(st|nd|rd|th)\b/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}

/** "ARABLAB LIVE 2026" -> "arablab-2026"; year "tba" when unknown. */
export function eventKey(name: string, year: number | null): string {
  const tokens = nameTokens(name).slice(0, 3);
  return `${tokens.join("-") || "event"}-${year ?? "tba"}`;
}

export type EventIdentity = { name: string; year: number | null; country: string | null };

/**
 * Same event when the years agree (or one is unknown), the countries do not
 * contradict, and one name's words start the other's: "ASMS" = "ASMS
 * Conference on Mass Spectrometry"; "analytica" (Munich) != "Analytica Lab
 * Expo" (India) because the countries differ.
 */
export function sameEvent(a: EventIdentity, b: EventIdentity): boolean {
  if (a.year !== null && b.year !== null && a.year !== b.year) return false;
  if (a.country && b.country && a.country !== b.country) return false;
  const ta = nameTokens(a.name);
  const tb = nameTokens(b.name);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t, i) => long[i] === t);
}

// ---------------------------------------------------------------------------
// Who is there
// ---------------------------------------------------------------------------

export type ParticipationEvidence = "listed_exhibitor" | "mentioned_on_event_page" | "announced_in_post";

const EXHIBITOR_PAGE = /exhibitor|sponsor|corporate[- ]member|floor[- ]?plan/i;
const EXHIBITOR_HEADING = /^#{1,6}\s.*(exhibitor|sponsor|corporate member)/im;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Brands named on an event page, with how strong the proof is. Case-sensitive
 * whole-name match ("Waters", not "waters" — rivers and lakes are common on
 * event pages). Listed = on an exhibitor/sponsor page, under such a heading,
 * or in a logo captioned "<Brand> at <Event>" (Terrapinn's Arablab list).
 */
export function brandsOnEventPage(
  page: { url: string; title?: string | null; markdown: string },
  brands: { id: string; name: string }[],
): { brandId: string; evidence: ParticipationEvidence; excerpt: string }[] {
  const exhibitorPage = EXHIBITOR_PAGE.test(`${page.url} ${page.title ?? ""}`);
  const headingAt = page.markdown.search(EXHIBITOR_HEADING);
  const out: { brandId: string; evidence: ParticipationEvidence; excerpt: string }[] = [];
  for (const brand of brands) {
    const name = brand.name.trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, "g");
    let best: { evidence: ParticipationEvidence; excerpt: string } | null = null;
    for (let m = re.exec(page.markdown); m; m = re.exec(page.markdown)) {
      const at = m.index + m[1].length;
      const excerpt = page.markdown
        .slice(Math.max(0, at - 60), at + name.length + 60)
        .replace(/\s+/g, " ")
        .trim();
      const logo = page.markdown[at - 1] === "[" && page.markdown[at - 2] === "!";
      const listed = exhibitorPage || logo || (headingAt >= 0 && at > headingAt);
      if (listed) {
        best = { evidence: "listed_exhibitor", excerpt };
        break;
      }
      best ??= { evidence: "mentioned_on_event_page", excerpt };
    }
    if (best) out.push({ brandId: brand.id, ...best });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export type EventTiming = "upcoming" | "happening" | "past" | "undated";

export function eventTiming(
  event: { startsOn: string | null; endsOn: string | null },
  now: Date,
): EventTiming {
  if (!event.startsOn) return "undated";
  const today = now.toISOString().slice(0, 10);
  const end = event.endsOn ?? event.startsOn;
  if (end < today) return "past";
  if (event.startsOn <= today) return "happening";
  return "upcoming";
}

/** Whole days from `now` to the event's first day (negative once started). */
export function daysUntil(startsOn: string, now: Date): number {
  const start = Date.UTC(+startsOn.slice(0, 4), +startsOn.slice(5, 7) - 1, +startsOn.slice(8, 10));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((start - today) / DAY);
}
