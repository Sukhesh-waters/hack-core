/**
 * CORE-3 plan test set: fixed briefs with synthetic contexts. Every company,
 * event and number here is invented — no client data, so the set can live in
 * the repo and run without a database.
 *
 * Each case exercises one rule the planner must keep (cold start, one plane
 * per phase, a fixed date, the 180-day limit, a revision, counter-evidence,
 * lessons). The critic set pairs hand-written plans with the verdict a person
 * gave them.
 */
import type { GeneratedPlan } from "./agent";
import type { PlanContext, PlanEvidence } from "./context";

export type PlanEvalCase = {
  id: string;
  label: string;
  context: PlanContext;
};

export type CriticEvalItem = {
  id: string;
  label: string;
  plan: GeneratedPlan;
  context: PlanContext;
  /** What a person decided when reviewing this plan. */
  expected: "pass" | "flagged";
};

const collected = new Date("2026-10-20T00:00:00Z");

function ev(id: string, plane: "A" | "B", content: string, extra: Partial<PlanEvidence> = {}): PlanEvidence {
  return {
    id,
    plane,
    content,
    sourceUrl: plane === "B" ? `https://example.com/${id}` : null,
    collectedAt: collected,
    confidence: plane === "B" ? 0.6 : null,
    ...extra,
  };
}

function context(overrides: Partial<PlanContext> & Pick<PlanContext, "brief">): PlanContext {
  return {
    worked: [],
    failed: [],
    patternEvidence: [],
    baselineEvidence: [],
    counterEvidence: null,
    learnedPatterns: [],
    coldStart: false,
    evidenceStatus: "matched",
    scopeLabel: "Northwind Analytical",
    clientProfile: null,
    anchor: null,
    revisionOf: null,
    ...overrides,
  };
}

const PUBLIC_EVIDENCE: PlanEvidence[] = [
  ev("b-1", "B", "Competitor Altamira Instruments posted three times in October about faster microplastics testing in drinking water; its posts drew about twice its usual engagement."),
  ev("b-2", "B", "Regional water utilities announced a joint tender for laboratory equipment to monitor emerging contaminants, closing in the first quarter of next year."),
  ev("b-3", "B", "Posts about method validation for contaminant testing rose over the last 30 days compared with the 90 days before, across four companies."),
];

const FIRST_PARTY_EVIDENCE: PlanEvidence[] = [
  ev("a-1", "A", "Northwind's own website lists a contaminant screening workflow with a published application note and an on-site training offer."),
  ev("a-2", "A", "Confirmed result: Northwind's carousel posts with a customer lab photo beat its usual post on engagement (worked)."),
];

export const PLAN_EVAL_CASES: PlanEvalCase[] = [
  {
    id: "cold-start",
    label: "No evidence, no results: must not claim evidence",
    context: context({
      brief: "Launch our new sample-prep kit\nfor environmental testing labs in the region",
      coldStart: true,
      evidenceStatus: "empty_brain",
    }),
  },
  {
    id: "public-only",
    label: "Public evidence only: cite shown ids, never invent one",
    context: context({
      brief: "Promote our microplastics testing workflow\nfor drinking-water labs",
      patternEvidence: PUBLIC_EVIDENCE,
    }),
  },
  {
    id: "two-planes",
    label: "Both planes shown: no phase may mix them",
    context: context({
      brief: "Promote contaminant screening and on-site training\nfor utility laboratories",
      patternEvidence: PUBLIC_EVIDENCE,
      baselineEvidence: FIRST_PARTY_EVIDENCE,
    }),
  },
  {
    id: "anchor-near",
    label: "Event in 21 days: a phase covers it, plan ends within a week after",
    context: context({
      brief: "Drive booth visits at Gulf Water Lab Expo\nfor lab managers attending the show",
      patternEvidence: PUBLIC_EVIDENCE,
      anchor: { label: "Gulf Water Lab Expo", day: 21 },
    }),
  },
  {
    id: "anchor-far",
    label: "Event in 160 days: stays inside the 180-day limit",
    context: context({
      brief: "Build demand before the Regional Utilities Summit\nfor procurement and lab leads",
      patternEvidence: PUBLIC_EVIDENCE,
      anchor: { label: "Regional Utilities Summit", day: 160 },
    }),
  },
  {
    id: "revision",
    label: "Revision with new evidence: keeps a revision note",
    context: context({
      brief: "Promote our microplastics testing workflow\nfor drinking-water labs",
      patternEvidence: [
        ...PUBLIC_EVIDENCE.slice(0, 2),
        ev("b-4", "B", "Altamira Instruments stopped posting about microplastics and moved to PFAS testing in the last two weeks.", { isNew: true }),
      ],
      revisionOf: {
        title: "Microplastics workflow push",
        summary: "Four phases on LinkedIn and webinars answering Altamira's microplastics posts.",
        phases: ["Days 1-14 · LinkedIn · Proof posts", "Days 15-30 · Webinar · Method walk-through"],
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    }),
  },
  {
    id: "counter-evidence",
    label: "Counter-evidence shown: may be cited, never mixed with first-party",
    context: context({
      brief: "Promote method validation support\nfor contract testing labs",
      patternEvidence: PUBLIC_EVIDENCE,
      baselineEvidence: FIRST_PARTY_EVIDENCE.slice(0, 1),
      counterEvidence: ev("b-9", "B", "Earlier claim refuted: posts about method validation did not beat the usual post over 30 days.", { role: "counter" }),
    }),
  },
  {
    id: "lessons",
    label: "Worked and failed lessons: respects them, invents no figures",
    context: context({
      brief: "Promote our on-site training offer\nfor new laboratory staff",
      baselineEvidence: FIRST_PARTY_EVIDENCE,
      worked: [
        {
          title: "Customer lab stories",
          brief: "Show real customer labs",
          summary: "Carousel posts with customer lab photos. Channels: LinkedIn.",
          note: "Best engagement of the quarter.",
        },
      ],
      failed: [
        {
          title: "Cold email blast",
          brief: "Email every lab contact",
          summary: "One bulk email to the whole list. Channels: Email.",
          note: "Many unsubscribes, no replies.",
        },
      ],
      learnedPatterns: ["Carousel posts tend to beat the usual post (8 results)."],
    }),
  },
];

const SOUND_PLAN: GeneratedPlan = {
  title: "Microplastics workflow push",
  doc: {
    summary: "Answer the rise in microplastics testing posts with proof from our own workflow.",
    totalDays: 42,
    phases: [
      { id: "p1", name: "Proof posts", startDay: 1, endDay: 14, channel: "LinkedIn", message: "Show the workflow cutting sample prep time.", evidenceIds: ["b-1"] },
      { id: "p2", name: "Method webinar", startDay: 15, endDay: 28, channel: "Webinar", message: "Walk labs through method validation step by step.", evidenceIds: ["b-3"] },
      { id: "p3", name: "Tender follow-up", startDay: 29, endDay: 42, channel: "Email", message: "Offer a tender-ready specification sheet to utility labs.", evidenceIds: ["b-2"] },
    ],
  },
};

export const CRITIC_EVAL_SET: CriticEvalItem[] = [
  {
    id: "sound",
    label: "Sound plan, phases serve the brief, no gaps",
    plan: SOUND_PLAN,
    context: PLAN_EVAL_CASES[1]!.context,
    expected: "pass",
  },
  {
    id: "gap-and-off-brief",
    label: "Six-week gap and a phase unrelated to the brief",
    plan: {
      title: "Microplastics push",
      doc: {
        summary: "Promote the workflow, then a holiday giveaway.",
        totalDays: 90,
        phases: [
          { id: "p1", name: "Proof posts", startDay: 1, endDay: 10, channel: "LinkedIn", message: "Show the workflow cutting sample prep time." },
          { id: "p2", name: "Holiday giveaway", startDay: 55, endDay: 90, channel: "Instagram", message: "Win branded mugs by liking our page." },
        ],
      },
    },
    context: PLAN_EVAL_CASES[1]!.context,
    expected: "flagged",
  },
  {
    id: "repeats-failure",
    label: "Repeats the bulk email that failed, without changing the approach",
    plan: {
      title: "Training offer blast",
      doc: {
        summary: "Email the whole contact list about training.",
        totalDays: 14,
        phases: [
          { id: "p1", name: "Bulk email", startDay: 1, endDay: 7, channel: "Email", message: "Send one email about training to every lab contact." },
          { id: "p2", name: "Reminder email", startDay: 8, endDay: 14, channel: "Email", message: "Send the same email again to everyone who did not reply." },
        ],
      },
    },
    context: PLAN_EVAL_CASES[7]!.context,
    expected: "flagged",
  },
  {
    id: "sound-training",
    label: "Sound plan that reuses what worked",
    plan: {
      title: "Training through customer stories",
      doc: {
        summary: "Use customer lab stories to promote on-site training to new staff.",
        totalDays: 35,
        phases: [
          { id: "p1", name: "Customer lab carousels", startDay: 1, endDay: 14, channel: "LinkedIn", message: "Show new staff trained on site in a customer lab.", evidenceIds: ["a-2"] },
          { id: "p2", name: "Training page", startDay: 8, endDay: 28, channel: "Website", message: "Explain what the on-site training covers and who it is for.", evidenceIds: ["a-1"] },
          { id: "p3", name: "Booking reminders", startDay: 21, endDay: 35, channel: "LinkedIn", message: "Invite lab managers to book a training slot." },
        ],
      },
    },
    context: PLAN_EVAL_CASES[7]!.context,
    expected: "pass",
  },
];
