/**
 * Page readiness (C8.0). Pure: turns one workspace's page facts into "what
 * each Platina page shows right now", so an empty page is always reported
 * with the reason and the step that fills it — never as a silent blank.
 *
 * "thin" means the page renders but a main part of it is missing (events
 * without dates, a Brain with no first-party side). The same rows feed the
 * readiness script, the journey test and the "Pages have content" ops check.
 */
import type { OpsCheck } from "./checks";

export type PageFactsInput = {
  findings: number;
  findingsNewest: string | null;
  runs: number;
  runsNewest: string | null;
  signals: number;
  signalsNewest: string | null;
  adDocs: number;
  adDocsNewest: string | null;
  brain: number;
  brainNewest: string | null;
  brands: number;
  profiles: number;
  interest: number;
  interestNewest: string | null;
  eventsUpcoming: number;
  eventsUndated: number;
  eventsNewest: string | null;
  plans: number;
  plansNewest: string | null;
  creatives: number;
  creativesNewest: string | null;
  outcomes: number;
  solutionTasks: number;
  brandChunks: number;
  ownChunks: number;
  ownChunksNewest: string | null;
  learningEvents: number;
};

export type PageStatus = "content" | "thin" | "empty";

export type PageReadiness = {
  page: string;
  /** Route segment under /p/[ws] ("" = Cockpit). */
  slug: string;
  status: PageStatus;
  /** What the page shows, in words ("238 collected items, 132 insights"). */
  shows: string;
  newest: string | null;
  /** Why it is empty or thin, and the step that fills it. Null when it has content. */
  gap: string | null;
  /** A main page: amber on the ops board when empty. */
  main: boolean;
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function newestOf(...values: (string | null)[]): string | null {
  const present = values.filter((v): v is string => Boolean(v));
  return present.length === 0 ? null : present.sort().at(-1)!;
}

export function pageReadiness(f: PageFactsInput): PageReadiness[] {
  const page = (
    p: Omit<PageReadiness, "status" | "gap"> & { empty: boolean; thin?: string | false; fill: string },
  ): PageReadiness => ({
    page: p.page,
    slug: p.slug,
    shows: p.shows,
    newest: p.newest,
    main: p.main,
    status: p.empty ? "empty" : p.thin ? "thin" : "content",
    gap: p.empty ? p.fill : p.thin ? p.thin : null,
  });

  return [
    page({
      page: "Cockpit",
      slug: "",
      main: true,
      shows: `${n(f.findings, "finding")}, ${n(f.runs, "collection run")}`,
      newest: newestOf(f.findingsNewest, f.runsNewest),
      empty: f.findings === 0 && f.runs === 0,
      fill: "No collection has run yet: approve sources on Audits (or run platina:force).",
    }),
    page({
      page: "Live flow",
      slug: "live",
      main: true,
      shows: `${n(f.signals, "collected item")}, ${n(f.brain, "insight")}`,
      newest: newestOf(f.signalsNewest, f.brainNewest),
      empty: f.signals === 0,
      thin: f.brain === 0 && "Items are collected but none has become an insight yet: the analysis job has not run.",
      fill: "Nothing collected yet: run platina:force for this workspace.",
    }),
    page({
      page: "Clients",
      slug: "brands",
      main: true,
      shows: `${n(f.brands, "client or competitor", "clients and competitors")}`,
      newest: null,
      empty: f.brands === 0,
      thin: f.profiles === 0 && "No workspace profile (division and region): pages fall back to generic wording.",
      fill: "No client yet: onboard one on Start.",
    }),
    page({
      page: "Opportunities",
      slug: "opportunities",
      main: true,
      shows: `${n(f.interest, "interest signal")}, ${n(f.eventsUpcoming, "dated upcoming event")}, ${f.eventsUndated} undated`,
      newest: newestOf(f.interestNewest, f.eventsNewest),
      empty: f.interest === 0 && f.eventsUpcoming === 0 && f.eventsUndated === 0,
      // Undated events are not "upcoming" (no date to compare): thin when they outnumber the dated ones.
      thin:
        f.eventsUndated > f.eventsUpcoming &&
        `${n(f.eventsUndated, "event")} still without a date: the conference pages and date follow-up fill them.`,
      fill: "No interest or events yet: collect LinkedIn posts and conference pages.",
    }),
    page({
      page: "Plan",
      slug: "plan",
      main: true,
      shows: n(f.plans, "plan"),
      newest: f.plansNewest,
      empty: f.plans === 0,
      fill: "No plan yet: start one from an opportunity (Plan this).",
    }),
    page({
      page: "Results",
      slug: "results",
      main: true,
      shows: `${n(f.creatives, "logged creative")}, ${n(f.learningEvents, "learning event")}`,
      newest: f.creativesNewest,
      empty: f.creatives === 0,
      fill: "Nothing posted has been logged: log creatives on Results (the public learning lane, C8.5, adds the client's own public posts).",
    }),
    page({
      page: "Outcomes",
      slug: "outcomes",
      main: false,
      shows: n(f.outcomes, "outcome"),
      newest: null,
      empty: f.outcomes === 0,
      fill: "No campaign outcome imported: import a CSV on Outcomes when the client shares results.",
    }),
    page({
      page: "Audits",
      slug: "audits",
      main: false,
      shows: n(f.runs, "run"),
      newest: f.runsNewest,
      empty: f.runs === 0,
      fill: "No source approved yet.",
    }),
    page({
      page: "Findings",
      slug: "findings",
      main: false,
      shows: n(f.findings, "finding"),
      newest: f.findingsNewest,
      empty: f.findings === 0,
      fill: "No finding yet: they appear after the first analysed collection.",
    }),
    page({
      page: "Solutions",
      slug: "solutions",
      main: false,
      shows: n(f.solutionTasks, "task"),
      newest: null,
      empty: f.solutionTasks === 0,
      fill: "No solution task: create one from a finding.",
    }),
    page({
      page: "Brand Gene",
      slug: "brand",
      main: false,
      shows: `${n(f.brandChunks, "confirmed brand line")}, ${n(f.ownChunks, "own-site passage")}`,
      newest: f.ownChunksNewest,
      empty: f.brandChunks === 0 && f.ownChunks === 0,
      thin: f.brandChunks === 0 && "No confirmed brand standard: review the client's profile on Clients, then Confirm as brand standard.",
      fill: "Nothing from the client's own site yet: run the own-site pass.",
    }),
    page({
      page: "Ads (ad libraries)",
      slug: "ads",
      main: false,
      shows: n(f.adDocs, "ad-library read"),
      newest: f.adDocsNewest,
      empty: f.adDocs === 0,
      fill: "No ad-library read yet: run an ads sweep (C8.3).",
    }),
  ];
}

/** Ops board: amber when a main page is empty; thin pages are listed but stay green. */
export function checkPagesHaveContent(pages: PageReadiness[]): OpsCheck {
  const base = { id: "pages_content", label: "Pages have content", required: false };
  const empty = pages.filter((p) => p.main && p.status === "empty");
  const thin = pages.filter((p) => p.status === "thin");
  const value = { empty: empty.length, thin: thin.length, pages: pages.length };
  if (empty.length > 0) {
    return {
      ...base,
      status: "degraded",
      detail: `${empty.map((p) => p.page).join(", ")} ${empty.length === 1 ? "is" : "are"} empty.`,
      remedy: empty[0].gap ?? undefined,
      value,
    };
  }
  return {
    ...base,
    status: "ok",
    detail:
      thin.length === 0
        ? "Every main page has content."
        : `Every main page has content; thin: ${thin.map((p) => p.page).join(", ")}.`,
    value,
  };
}
