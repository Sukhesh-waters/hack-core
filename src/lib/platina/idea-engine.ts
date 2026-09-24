/**
 * The idea engine (C8.5 T85.5, ask A5). Pure: triggers, the prompt, and the
 * checks on the model's answer. The route streams the steps and records every
 * idea in the suggestion ledger, so each one can be traced to what caused it.
 *
 * An idea is drafted when something in the live data crosses a threshold
 * (a trigger): a dated event in the region, a subject rising past min-N, a
 * competitor ad push, a region the competitors advertise in and the client
 * does not. Each idea rests on three labelled lists, never mixed in one line:
 *
 *   F1..  the trigger's public facts            (Plane B)
 *   A1..  the client's Brand DNA: its own pages (Plane A)
 *   P1..  learned patterns: what has worked     (the ledger and the public lane)
 *
 * About 80% of ideas follow the learned patterns and cite one; about 20% try
 * something new and are labelled so. Code, not the model's word, drops an
 * idea that cites the wrong list, cites nothing, or carries a number that is
 * not in what it cites.
 */
import { z } from "zod";
import type { AdDetection } from "./ads-view";
import { extractJson } from "./json";
import type { Campaign } from "./opportunities";

export const IDEAS_PER_RUN = 5;
/** 1 of 5: about 20% of ideas try something new. */
export const EXPLORE_PER_RUN = 1;
/** Ideas drafted per workspace per UTC day, at most (budget control). */
export const DAILY_IDEA_CAP = 15;
export const IDEA_PROMPT_VERSION = "idea-engine-v1";
/** Event triggers look this far ahead. */
export const EVENT_TRIGGER_DAYS = 120;

export type TriggerKind = "event" | "rising_topic" | "ad_push" | "region_gap" | "ad_white_space";

export type IdeaTrigger = {
  key: string;
  kind: TriggerKind;
  title: string;
  facts: { text: string; url: string | null }[];
  topic: string | null;
  priority: number;
};

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  event: "Event coming up",
  rising_topic: "Subject rising",
  ad_push: "Competitor ad push",
  region_gap: "Region gap in ads",
  ad_white_space: "Ad white space",
};

const daysOut = (c: Campaign): number | null => {
  const m = /in (\d+) day/.exec(c.timing ?? "");
  return m ? Number(m[1]) : null;
};

/** What in today's data is worth an idea, most pressing first. */
export function findTriggers(input: {
  events: Campaign[];
  topics: Campaign[];
  adDetections: AdDetection[];
  regionCodes: readonly string[];
}): IdeaTrigger[] {
  const out: IdeaTrigger[] = [];
  const factsOf = (c: Campaign) => [
    ...c.why.map((w) => ({ text: w, url: c.proofs[0]?.url ?? null })),
    ...c.proofs.slice(0, 4).map((p) => ({ text: p.label, url: p.url ?? null })),
    ...(c.dates ? [{ text: `Dates: ${c.dates}`, url: c.proofs[0]?.url ?? null }] : []),
    ...(c.place ? [{ text: `Place: ${c.place}`, url: c.proofs[0]?.url ?? null }] : []),
  ];
  for (const c of input.events) {
    const d = daysOut(c);
    if (d === null || d > EVENT_TRIGGER_DAYS) continue;
    const inRegion = input.regionCodes.some((code) => (c.place ?? "").includes(code)) || c.factors.some((f) => /gulf|gcc|home region/i.test(`${f.label} ${f.value}`));
    out.push({ key: `trigger:${c.key}`, kind: "event", title: c.title, facts: factsOf(c), topic: c.creativeTopic, priority: (inRegion ? 0.9 : 0.6) - d / 1000 });
  }
  for (const c of input.topics) {
    out.push({ key: `trigger:${c.key}`, kind: "rising_topic", title: c.title, facts: factsOf(c), topic: c.creativeTopic, priority: 0.6 });
  }
  for (const d of input.adDetections) {
    const kind: TriggerKind | null = d.kind === "push" ? "ad_push" : d.kind === "region_gap" ? "region_gap" : d.kind === "theme_gap" ? "ad_white_space" : null;
    if (!kind) continue;
    const topic = d.kind === "push" ? d.key.split(":").slice(2).join(":") : d.kind === "theme_gap" ? d.key.slice("theme_gap:".length) : null;
    out.push({
      key: `trigger:ads:${d.key}`,
      kind,
      title: d.title,
      facts: [{ text: d.detail, url: d.proofs[0]?.url ?? null }, ...d.proofs.map((p) => ({ text: `Ad: ${p.label}`, url: p.url }))],
      topic,
      priority: kind === "region_gap" ? 0.85 : kind === "ad_push" ? 0.8 : 0.7,
    });
  }
  return out.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}

export type Evidence = { id: string; list: "F" | "A" | "P"; text: string; url: string | null; ref: string };

export function labelEvidence(
  trigger: IdeaTrigger,
  own: { content: string; sourceUrl: string | null }[],
  patterns: { text: string; ref: string }[],
): { F: Evidence[]; A: Evidence[]; P: Evidence[] } {
  return {
    F: trigger.facts.slice(0, 10).map((f, i) => ({ id: `F${i + 1}`, list: "F", text: f.text, url: f.url, ref: f.url ? `url:${f.url}` : `fact:${trigger.key}:${i}` })),
    A: own.slice(0, 6).map((o, i) => ({
      id: `A${i + 1}`,
      list: "A",
      text: o.content.replace(/\s+/g, " ").slice(0, 450),
      url: o.sourceUrl,
      ref: `own:${o.sourceUrl ?? i}`,
    })),
    P: patterns.slice(0, 6).map((p, i) => ({ id: `P${i + 1}`, list: "P", text: p.text, url: null, ref: p.ref })),
  };
}

export function buildIdeaPrompt(input: { clientName: string; trigger: IdeaTrigger; F: Evidence[]; A: Evidence[]; P: Evidence[] }): string {
  const list = (rows: Evidence[]) => rows.map((r) => `[${r.id}] ${r.text}`).join("\n");
  const follow = IDEAS_PER_RUN - EXPLORE_PER_RUN;
  return [
    `Client: ${input.clientName}. Trigger (${TRIGGER_LABEL[input.trigger.kind]}): ${input.trigger.title}.`,
    `PUBLIC FACTS about the trigger (cite as F-ids):\n${list(input.F)}`,
    `${input.clientName.toUpperCase()}'S BRAND DNA, from its own pages (cite as A-ids):\n${input.A.length ? list(input.A) : "none found"}`,
    `LEARNED PATTERNS, what has worked for ${input.clientName} (cite as P-ids):\n${input.P.length ? list(input.P) : "none yet"}`,
    [
      `Propose ${IDEAS_PER_RUN} campaign ideas that answer the trigger. Each idea:`,
      "- title: a short, specific campaign name (no numbers unless in the facts).",
      "- channel: linkedin, event, email, webinar or web. format: post, carousel, video, article, booth, webinar or email.",
      "- hook: the opening line a buyer would see.",
      "- why: 1-2 lines on why now, citing ONLY F-ids.",
      `- fit: one line on which ${input.clientName} product or capability carries it, citing ONLY A-ids (null if no A-ids exist).`,
      input.P.length
        ? `- pattern: one line citing ONLY P-ids for the learned pattern it follows. Exactly ${follow} ideas follow a pattern (explore=false); exactly ${EXPLORE_PER_RUN} tries something new on purpose (explore=true, pattern=null).`
        : "- pattern: null (nothing learned yet); explore=false.",
      "Never write ids inside any text: put them only in cites. Do not invent numbers, results, prices or claims.",
    ].join("\n"),
    'Reply JSON only: {"ideas":[{"title":string,"channel":string,"format":string,"hook":string,"why":[{"text":string,"cites":string[]}],"fit":{"text":string,"cites":string[]}|null,"pattern":{"text":string,"cites":string[]}|null,"explore":boolean}]}',
  ].join("\n\n");
}

export type IdeaLine = { text: string; cites: Evidence[] };
export type Idea = {
  title: string;
  channel: string;
  format: string;
  hook: string;
  why: IdeaLine[];
  fit: IdeaLine | null;
  pattern: IdeaLine | null;
  explore: boolean;
};

const lineSchema = z.object({ text: z.string().trim().min(8).max(400), cites: z.array(z.string()).default([]) });
const ideaSchema = z.object({
  title: z.string().trim().min(4).max(140),
  channel: z.string().trim().min(2).max(30),
  format: z.string().trim().min(2).max(30),
  hook: z.string().trim().min(4).max(300),
  why: z.array(z.unknown()).default([]),
  fit: z.unknown().nullable().default(null),
  pattern: z.unknown().nullable().default(null),
  explore: z.boolean().default(false),
});
const replySchema = z.object({ ideas: z.array(z.unknown()).default([]) });

const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)?/g) ?? [];
const stripIds = (s: string) => s.replace(/\s*[([]?\b[FAP]\d+\b(?:\s*,\s*\b[FAP]\d+\b)*[)\]]?/g, "").replace(/\s{2,}/g, " ").trim();

function checkLine(raw: unknown, allowed: Map<string, Evidence>): IdeaLine | null {
  const parsed = lineSchema.safeParse(raw);
  if (!parsed.success) return null;
  const ids = [...new Set(parsed.data.cites.map((c) => c.trim().replace(/^\[|\]$/g, "")))];
  if (ids.length === 0 || !ids.every((id) => allowed.has(id))) return null;
  const cites = ids.map((id) => allowed.get(id)!);
  const text = stripIds(parsed.data.text);
  if (!numbers(text).every((n) => cites.some((c) => c.text.includes(n)))) return null;
  return { text, cites };
}

/**
 * Keeps an idea only if: at least one "why" line cites the trigger's facts;
 * its fit cites Brand DNA (when any exists); a pattern-following idea cites a
 * pattern (when any exists). Title and hook carry no citations, so they may
 * carry no number the evidence does not. At most EXPLORE_PER_RUN explore ideas.
 */
export function parseIdeas(raw: string, ev: { F: Evidence[]; A: Evidence[]; P: Evidence[] }): { ideas: Idea[]; dropped: { title: string; why: string }[] } {
  let reply: z.infer<typeof replySchema>;
  try {
    reply = replySchema.parse(extractJson(raw));
  } catch (error) {
    throw new Error(`the model's ideas were not the expected JSON: ${error instanceof Error ? error.message.slice(0, 120) : ""}`);
  }
  const F = new Map(ev.F.map((e) => [e.id, e]));
  const A = new Map(ev.A.map((e) => [e.id, e]));
  const P = new Map(ev.P.map((e) => [e.id, e]));
  const all = [...ev.F, ...ev.A, ...ev.P].map((e) => e.text).join(" ");
  const ideas: Idea[] = [];
  const dropped: { title: string; why: string }[] = [];
  let explored = 0;
  for (const rawIdea of reply.ideas.slice(0, IDEAS_PER_RUN + 2)) {
    const parsed = ideaSchema.safeParse(rawIdea);
    if (!parsed.success) {
      dropped.push({ title: "(unreadable)", why: "not in the expected shape" });
      continue;
    }
    const i = parsed.data;
    const drop = (why: string) => dropped.push({ title: i.title, why });
    const why = i.why.slice(0, 3).map((w) => checkLine(w, F)).filter((w): w is IdeaLine => w !== null);
    if (why.length === 0) {
      drop("no 'why now' line cited the trigger's facts");
      continue;
    }
    const fit = i.fit ? checkLine(i.fit, A) : null;
    if (A.size > 0 && !fit) {
      drop("its fit did not cite the client's own pages");
      continue;
    }
    const explore = P.size > 0 && i.explore && explored < EXPLORE_PER_RUN;
    const pattern = i.pattern && !explore ? checkLine(i.pattern, P) : null;
    if (P.size > 0 && !explore && !pattern) {
      drop("it claimed to follow a learned pattern but cited none");
      continue;
    }
    if (![i.title, i.hook].every((t) => numbers(t).every((n) => all.includes(n)))) {
      drop("its title or hook carried a number that is not in the evidence");
      continue;
    }
    if (explore) explored += 1;
    ideas.push({ title: stripIds(i.title), channel: i.channel.toLowerCase(), format: i.format.toLowerCase(), hook: stripIds(i.hook), why, fit, pattern, explore });
    if (ideas.length >= IDEAS_PER_RUN) break;
  }
  return { ideas, dropped };
}
