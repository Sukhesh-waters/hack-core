/**
 * The conference calendar (C8.0 F0.4, was C7.3 T3.1; owner decision D13:
 * list checked). The shows that matter to a lab and analytical instruments
 * client, each with its OFFICIAL page, Gulf first. This is a list of sources,
 * not of facts: no date lives here. Dates, venue and exhibitors are read
 * from the official page and kept only with a quote (event-extract).
 *
 * Official URLs checked 2026-09-23 against each organiser's site. Left out
 * until they publish an official page: BCEIA 2027 (Beijing, autumn 2027).
 * Next editions to add when announced: ISC 2028, IMSC 2028.
 */
import { CONFERENCE_PRESETS } from "./presets";

export type CalendarRegion = "gcc" | "europe" | "americas" | "asia";

export type CalendarShow = {
  key: string;
  name: string;
  /** The organiser's own page for the show (never a listing site). */
  url: string;
  region: CalendarRegion;
  /** ISO country of the usual venue: the map and region fit. */
  country: string;
  city: string;
  /** Lab topics it gathers, in the words Opportunities matches on. */
  topics: string[];
  /** Why a Waters-type client cares, in one line. */
  why: string;
};

const preset = (key: string): string => {
  const found = CONFERENCE_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`conference preset "${key}" missing`);
  return found.url;
};

export const CONFERENCE_CALENDAR: CalendarShow[] = [
  // --- Gulf and Middle East ---------------------------------------------
  {
    key: "arablab",
    name: "ARABLAB LIVE (Dubai)",
    url: preset("arablab"),
    region: "gcc",
    country: "AE",
    city: "Dubai",
    topics: ["laboratory", "analytical instruments", "chromatography", "mass spectrometry"],
    why: "The region's largest lab and analytical show.",
  },
  {
    key: "global-health",
    name: "Global Health Exhibition (Riyadh)",
    url: "https://www.globalhealthsaudi.com/",
    region: "gcc",
    country: "SA",
    city: "Riyadh",
    topics: ["healthcare", "diagnostics", "clinical laboratory"],
    why: "Saudi healthcare and diagnostics buyers in one place.",
  },
  {
    key: "cphi-middle-east",
    name: "CPHI Middle East (Riyadh)",
    url: "https://www.cphi.com/middle-east/",
    region: "gcc",
    country: "SA",
    city: "Riyadh",
    topics: ["pharma", "quality control", "biotech"],
    why: "Pharma QC and biotech manufacturing in the Gulf.",
  },
  {
    key: "whx-labs",
    name: "WHX Labs Dubai (formerly Medlab Middle East)",
    url: preset("whx-labs"),
    region: "gcc",
    country: "AE",
    city: "Dubai",
    topics: ["clinical laboratory", "diagnostics"],
    why: "The Gulf's clinical lab show.",
  },
  {
    key: "duphat",
    name: "DUPHAT (Dubai)",
    url: "https://duphat.ae/",
    region: "gcc",
    country: "AE",
    city: "Dubai",
    topics: ["pharma", "pharmaceutical analysis"],
    why: "MENA's largest pharmaceutical exhibition.",
  },
  // --- Europe -------------------------------------------------------------
  {
    key: "cphi-milan",
    name: "CPHI Milan",
    url: "https://www.cphi.com/europe/",
    region: "europe",
    country: "IT",
    city: "Milan",
    topics: ["pharma", "quality control"],
    why: "The global pharma supply-chain show.",
  },
  {
    key: "slas-europe",
    name: "SLAS Europe 2027",
    url: "https://www.slas.org/events-calendar/slas-europe-2027-conference-and-exhibition/",
    region: "europe",
    country: "DE",
    city: "Hamburg",
    topics: ["lab automation", "screening", "informatics"],
    why: "Lab automation buyers in Europe.",
  },
  {
    key: "cyto",
    name: "CYTO 2027",
    url: "https://www.cytoconference.org/",
    region: "europe",
    country: "FI",
    city: "Helsinki",
    topics: ["flow cytometry", "cell analysis"],
    why: "Flow cytometry: the BD Biosciences side of Waters.",
  },
  {
    key: "achema",
    name: "ACHEMA 2027",
    url: "https://www.achema.de/en/",
    region: "europe",
    country: "DE",
    city: "Frankfurt",
    topics: ["process analytics", "laboratory", "chemical engineering"],
    why: "Process and lab technology, every three years.",
  },
  {
    key: "hplc",
    name: "HPLC 2027 symposium",
    url: preset("hplc"),
    region: "europe",
    country: "AT",
    city: "Innsbruck",
    topics: ["chromatography", "liquid chromatography", "separation science"],
    why: "The main separation-science meeting.",
  },
  {
    key: "analytica",
    name: "analytica trade fair (Munich)",
    url: preset("analytica"),
    region: "europe",
    country: "DE",
    city: "Munich",
    topics: ["laboratory", "analytical instruments", "biotech"],
    why: "Europe's largest lab fair (next edition 2028).",
  },
  // --- Americas -----------------------------------------------------------
  {
    key: "slas",
    name: "SLAS2027 International Conference",
    url: "https://www.slas.org/events-calendar/slas2027-international-conference-exhibition/",
    region: "americas",
    country: "US",
    city: "San Diego",
    topics: ["lab automation", "screening", "informatics"],
    why: "North America's largest lab automation gathering.",
  },
  {
    key: "pittcon",
    name: "Pittcon conference and exposition",
    url: preset("pittcon"),
    region: "americas",
    country: "US",
    city: "Pittsburgh",
    topics: ["analytical chemistry", "chromatography", "mass spectrometry", "spectroscopy"],
    why: "The analytical chemistry show.",
  },
  {
    key: "asms",
    name: "ASMS annual conference",
    url: preset("asms"),
    region: "americas",
    country: "US",
    city: "Houston",
    topics: ["mass spectrometry"],
    why: "The mass spectrometry conference.",
  },
  {
    key: "bio",
    name: "BIO International Convention",
    url: "https://convention.bio.org/future-dates",
    region: "americas",
    country: "US",
    city: "Philadelphia",
    topics: ["biotech", "biopharma"],
    why: "Biotech and biopharma decision-makers.",
  },
  {
    key: "adlm",
    name: "ADLM 2027 (Clinical Lab Expo)",
    url: "https://meeting.myadlm.org/",
    region: "americas",
    country: "US",
    city: "Chicago",
    topics: ["clinical laboratory", "diagnostics", "clinical mass spectrometry"],
    why: "The largest clinical lab exposition.",
  },
  {
    key: "aoac",
    name: "AOAC INTERNATIONAL Annual Meeting 2027",
    url: "https://www.aoac.org/events/2027-aoac-international-annual-meeting-exposition/",
    region: "americas",
    country: "CA",
    city: "Toronto",
    topics: ["food analysis", "analytical methods", "PFAS"],
    why: "Food and analytical method standards.",
  },
  {
    key: "msacl",
    name: "MSACL 2027",
    url: "https://msacl.org/index.php?header=Events&subtab=MSACL_2027&tab=Future",
    region: "americas",
    country: "CA",
    city: "Montreal",
    topics: ["clinical mass spectrometry", "mass spectrometry"],
    why: "Clinical mass spectrometry users.",
  },
  {
    key: "acs",
    name: "ACS meetings and expositions",
    url: preset("acs"),
    region: "americas",
    country: "US",
    city: "varies",
    topics: ["chemistry", "analytical chemistry"],
    why: "American Chemical Society national meetings.",
  },
  // --- Asia ---------------------------------------------------------------
  {
    key: "analytica-china",
    name: "analytica China",
    url: "https://www.analyticachina.com.cn/en/",
    region: "asia",
    country: "CN",
    city: "Shanghai",
    topics: ["laboratory", "analytical instruments", "biotech"],
    why: "Asia's largest lab and analytical fair.",
  },
  {
    key: "jasis",
    name: "JASIS (Japan Analytical & Scientific Instruments Show)",
    url: "https://www.jasis.jp/en/",
    region: "asia",
    country: "JP",
    city: "Chiba",
    topics: ["analytical instruments", "scientific instruments"],
    why: "Japan's analytical instruments show (Shimadzu's home market).",
  },
];

/** Gulf first, then Europe, Americas, Asia; the list order within a region. */
export const REGION_ORDER: CalendarRegion[] = ["gcc", "europe", "americas", "asia"];

export function calendarShows(regions?: CalendarRegion[]): CalendarShow[] {
  const wanted = regions && regions.length > 0 ? regions : REGION_ORDER;
  return REGION_ORDER.filter((r) => wanted.includes(r)).flatMap((r) =>
    CONFERENCE_CALENDAR.filter((s) => s.region === r),
  );
}
