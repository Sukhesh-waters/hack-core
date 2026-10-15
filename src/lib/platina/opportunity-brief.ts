/**
 * AI campaign brief for one opportunity (C8.4). Pure: evidence labelling,
 * the prompt, and the checks on the model's answer. The route streams the
 * steps (lib stays IO-free).
 *
 * Two lists, never mixed (constitution, two-layer rule):
 *   F1..Fn  public facts behind the opportunity (Plane B: events, posts, ads)
 *   A1..An  the client's own pages (Plane A, first-party)
 * "Why now" may cite only F; "fit" and "sales angle" only A. A line citing
 * the wrong list, or nothing, is dropped by code — not by the model's word.
 * Numbers stay where they were measured: the model is told not to add any,
 * and a digit in a brief line that is not in its cited evidence drops it.
 */
import { z } from "zod";
import { CONFERENCE_CALENDAR } from "./conference-calendar";
import { DERIVED_SHARE, EVIDENCE_TOKEN_BUDGET, estimateTokens, fitSections } from "./context-budget";
import { diversifyEvidence, type Candidate, type DiversifyStats } from "./diversify";
import { extractJson } from "./json";
import type { Campaign } from "./opportunities";

export type BriefEvidence = { id: string; plane: "A" | "B"; text: string; url: string | null };

export type BriefLine = { text: string; cites: BriefEvidence[] };

export type CampaignBrief = {
  goal: string;
  audience: string;
  whyNow: BriefLine[];
  fit: BriefLine[];
  salesAngle: BriefLine | null;
  steps: { when: string; what: string }[];
  dropped: number;
  /** W3b-rest: opposing or refuted Brain claim on the opportunity's subject (when retrieval mode is "on"). */
  counterEvidence?: string | null;
};

/** Public facts behind the opportunity, labelled F1.. (from the computed campaign). */
export function publicFacts(c: Campaign): BriefEvidence[] {
  const facts: BriefEvidence[] = c.why.map((w, i) => ({
    id: `F${i + 1}`,
    plane: "B" as const,
    text: w,
    url: c.proofs[0]?.url ?? null,
  }));
  for (const p of c.proofs) {
    facts.push({ id: `F${facts.length + 1}`, plane: "B", text: p.label, url: p.url ?? null });
  }
  if (c.dates) facts.push({ id: `F${facts.length + 1}`, plane: "B", text: `Dates: ${c.dates}`, url: c.proofs[0]?.url ?? null });
  if (c.place) facts.push({ id: `F${facts.length + 1}`, plane: "B", text: `Place: ${c.place}`, url: c.proofs[0]?.url ?? null });
  return facts;
}

/** The client's own passages, labelled A1.. . */
/** Investor and results pages say nothing about product fit (live 2026-09-23: a 2023 results release slipped in). */
const NOT_PRODUCT = /financial results|reports (first|second|third|fourth) quarter|earnings (call|release)|investor relations|dividend/i;

export function ownPassages(rows: { content: string; sourceUrl: string | null }[]): BriefEvidence[] {
  return rows.filter((r) => !NOT_PRODUCT.test(r.content)).map((r, i) => ({
    id: `A${i + 1}`,
    plane: "A" as const,
    text: r.content.replace(/\s+/g, " ").slice(0, 500),
    url: r.sourceUrl,
  }));
}

export type BriefBrainCandidate = {
  id: string;
  content: string;
  sourceUrl?: string | null;
  subjectKey?: string | null;
  direction?: "up" | "down" | "none" | null;
  gradeState?: "untested" | "holding" | "promoted" | "refuted" | "insufficient" | null;
  status?: string;
  generation?: number;
  sourceSignalIds?: string[];
  absorbedChunkIds?: string[];
};

const rankRel = (i: number, len: number) => 1 - i / Math.max(1, len);

/**
 * W3b-rest — anti-echo + token-budget selection for Opportunity Briefs and
 * Idea Runs (pure, IO-free). Filters investor/results pages out of own-site
 * passages first, then runs MMR, lineage dedup, the derived-share cap, the
 * counter-evidence slot, and (when `budgetOn`) the hard evidence token budget.
 */
export function selectBriefEvidence(input: {
  ownRows: { id?: string; content: string; sourceUrl: string | null }[];
  brainRows?: BriefBrainCandidate[];
  refutedRows?: BriefBrainCandidate[];
  derivedShare?: number;
  budgetOn?: boolean;
  k?: number;
  evidenceTokenBudget?: number;
}): {
  own: BriefEvidence[];
  counter: BriefEvidence | null;
  stats: DiversifyStats & { budgetDropped: number };
} {
  const k = input.k ?? 6;
  const evidenceTokenBudget = input.evidenceTokenBudget ?? EVIDENCE_TOKEN_BUDGET;
  const derivedShare = input.derivedShare ?? DERIVED_SHARE;
  const filteredOwn = input.ownRows
    .filter((r) => !NOT_PRODUCT.test(r.content))
    .map((r, i) => ({
      id: r.id ?? `own_${i + 1}`,
      content: r.content.replace(/\s+/g, " ").slice(0, 500),
      sourceUrl: r.sourceUrl,
    }));
  const brain = input.brainRows ?? [];
  const supportIds = new Set(brain.map((b) => b.id));
  const refuted = (input.refutedRows ?? []).filter((r) => !supportIds.has(r.id));

  const toBrainCand = (b: BriefBrainCandidate, relevance: number): Candidate => ({
    id: b.id,
    content: b.content.replace(/\s+/g, " ").slice(0, 500),
    relevance,
    derived: true,
    plane: "B",
    subjectKey: b.subjectKey ?? null,
    direction: b.direction ?? null,
    gradeState: b.gradeState ?? null,
    status: b.status ?? "active",
    generation: b.generation ?? 0,
    lineage: {
      sourceSignalIds: b.sourceSignalIds ?? [],
      absorbedChunkIds: b.absorbedChunkIds ?? [],
    },
  });

  const candidates: Candidate[] = [
    ...filteredOwn.map((r, i) => ({
      id: r.id,
      content: r.content,
      relevance: rankRel(i, filteredOwn.length),
      derived: false,
      plane: "A" as const,
    })),
    ...brain.map((b, i) => toBrainCand(b, rankRel(i, brain.length))),
    ...refuted.map((r, i) => toBrainCand(r, 0.1 * rankRel(i, refuted.length))),
  ];

  const result = diversifyEvidence({
    candidates,
    k: k + Math.min(4, brain.length),
    evidenceTokenBudget,
    derivedShare,
    tokensOf: (c) => estimateTokens(c.content),
  });

  let support = result.items.filter((i) => i.role === "support").map((i) => i.candidate);
  let budgetDropped = 0;
  if (input.budgetOn) {
    const ordered = [...support].sort((a, b) => b.relevance - a.relevance);
    const fitted = fitSections(
      { evidence: ordered.map((c) => ({ id: c.id, text: c.content })) },
      { evidence: { cap: evidenceTokenBudget } },
    );
    const keptIds = new Set(fitted.sections.evidence.kept.map((i) => i.id));
    budgetDropped = support.length - keptIds.size;
    support = support.filter((c) => keptIds.has(c.id));
  }

  const keptOwnIds = new Set(support.filter((c) => !c.derived).map((c) => c.id));
  const own = filteredOwn
    .filter((r) => keptOwnIds.has(r.id))
    .slice(0, k)
    .map((r, i) => ({
      id: `A${i + 1}`,
      plane: "A" as const,
      text: r.content,
      url: r.sourceUrl,
    }));

  const counterCand = result.items.find((i) => i.role === "disconfirming")?.candidate ?? null;
  const byBrainId = new Map([...brain, ...refuted].map((b) => [b.id, b]));
  const counterSource = counterCand ? byBrainId.get(counterCand.id) : null;
  const counter: BriefEvidence | null = counterCand
    ? {
        id: "C1",
        plane: "B",
        text: counterCand.content,
        url: counterSource?.sourceUrl ?? null,
      }
    : null;

  return {
    own,
    counter,
    stats: { ...result.stats, budgetDropped },
  };
}

/**
 * What to look for on the client's own pages: the subjects the opportunity is
 * about, never the client's own name (live 2026-09-23: "waters" matched every
 * page and the brief read the quarterly results). An event on the conference
 * calendar brings its topics; a topic campaign brings its topic; the client's
 * own topics fill the rest.
 */
export function searchWords(c: Campaign, clientName: string, clientTopics: string[] = []): string[] {
  const own = new Set(clientName.toLowerCase().split(/\s+/));
  const hay = c.title.toLowerCase();
  const show = CONFERENCE_CALENDAR.find((s) => hay.includes(s.name.toLowerCase().split(/[\s(]+/)[0]));
  const topic = c.source === "topic" ? [c.key.replace(/^topic:/, "")] : [];
  const phrases = [...topic, ...(show?.topics ?? []), ...clientTopics];
  return [...new Set(phrases.map((w) => w.toLowerCase().trim()).filter((w) => w.length >= 3 && !own.has(w)))].slice(0, 6);
}

export function buildBriefPrompt(input: {
  clientName: string;
  campaign: Campaign;
  facts: BriefEvidence[];
  own: BriefEvidence[];
  counter?: BriefEvidence | null;
}): string {
  const { clientName, campaign: c } = input;
  const list = (rows: BriefEvidence[]) => rows.map((r) => `[${r.id}] ${r.text}`).join("\n");
  return [
    `Client: ${clientName}. Opportunity: ${c.title}.${c.startBy ? ` Start preparing by: ${c.startBy}.` : ""}`,
    `PUBLIC FACTS about the market (cite as F-ids):\n${list(input.facts)}`,
    `${clientName.toUpperCase()}'S OWN PAGES (cite as A-ids):\n${input.own.length ? list(input.own) : "none found"}`,
    ...(input.counter
      ? [`COUNTER-EVIDENCE (may contradict the above):\n[${input.counter.id}] ${input.counter.text}`]
      : []),
    [
      "Write a short campaign brief a marketing lead can act on this week.",
      "- whyNow: 2-3 lines on why this opportunity matters now. Cite ONLY F-ids.",
      `- fit: 1-3 lines on which of ${clientName}'s products or capabilities fit, from its own pages. Cite ONLY A-ids. If no A-ids exist, return an empty list.`,
      `- salesAngle: one line, the angle a salesperson would open with. Cite ONLY A-ids (null if none).`,
      "- goal, audience: one line each, no citations.",
      "- steps: 3-5 dated steps counted back from the event or start date (when = a date or 'week N').",
      "Do not invent numbers, results, prices or claims; do not repeat a number that is not in the cited text.",
      "Never write ids (F1, A2) inside any text: put them only in cites.",
    ].join("\n"),
    'Reply JSON only: {"goal":string,"audience":string,"whyNow":[{"text":string,"cites":string[]}],"fit":[{"text":string,"cites":string[]}],"salesAngle":{"text":string,"cites":string[]}|null,"steps":[{"when":string,"what":string}]}',
  ].join("\n\n");
}

const line = z.object({ text: z.string().trim().min(8).max(400), cites: z.array(z.string()).default([]) });
const replySchema = z.object({
  goal: z.string().trim().min(5).max(300),
  audience: z.string().trim().min(3).max(300),
  whyNow: z.array(z.unknown()).default([]),
  fit: z.array(z.unknown()).default([]),
  salesAngle: z.unknown().nullable().default(null),
  steps: z
    .array(z.object({ when: z.string().trim().min(1).max(40), what: z.string().trim().min(3).max(300) }))
    .max(6)
    .default([]),
});

const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** Ids and "A-ids" mentions anywhere in free text (steps carry no citations). */
const cleanIds = (s: string) =>
  s
    .replace(/\s*(?:using |see |with )?\b[FA]-ids?\b(?:\s+[FA]\d+(?:\s*,\s*[FA]\d+)*)?(?:\s+as reference)?/gi, "")
    .replace(/\s*\(\s*[FA]\d+(?:\s*,\s*[FA]\d+)*\s*\)/g, "")
    .replace(/\s*\b[FA]\d+\b(?:\s*,\s*\b[FA]\d+\b)*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** The model sometimes repeats its citation ids in the text ("... F3,F7"): they are shown as labels instead. */
const stripIds = (s: string) => s.replace(/\s*[([]?\b[FA]\d+\b(?:\s*,\s*\b[FA]\d+\b)*[)\]]?\s*(?=[.;]?\s*$)/, "").trim();

/**
 * Keeps a line only if it cites at least one id, every id is in the allowed
 * list, and every number in it appears in the text it cites.
 */
function checkLine(raw: unknown, allowed: Map<string, BriefEvidence>): BriefLine | null {
  const parsed = line.safeParse(raw);
  if (!parsed.success) return null;
  const ids = [...new Set(parsed.data.cites.map((c) => c.trim().replace(/^\[|\]$/g, "")))];
  if (ids.length === 0 || !ids.every((id) => allowed.has(id))) return null;
  const cites = ids.map((id) => allowed.get(id)!);
  const cited = cites.map((c) => c.text).join(" ");
  const text = stripIds(parsed.data.text);
  if (!numbers(text).every((n) => cited.includes(n))) return null;
  return { text, cites };
}

export function parseBrief(raw: string, facts: BriefEvidence[], own: BriefEvidence[]): CampaignBrief {
  let reply: z.infer<typeof replySchema>;
  try {
    reply = replySchema.parse(extractJson(raw));
  } catch (error) {
    throw new Error(`the model's brief was not the expected JSON: ${error instanceof Error ? error.message.slice(0, 120) : ""}`);
  }
  const F = new Map(facts.map((f) => [f.id, f]));
  const A = new Map(own.map((a) => [a.id, a]));
  let dropped = 0;
  const keep = (rows: unknown[], allowed: Map<string, BriefEvidence>) =>
    rows.slice(0, 4).flatMap((r) => {
      const ok = checkLine(r, allowed);
      if (!ok) dropped += 1;
      return ok ? [ok] : [];
    });
  const whyNow = keep(reply.whyNow, F);
  const fit = keep(reply.fit, A);
  const salesAngle = reply.salesAngle ? checkLine(reply.salesAngle, A) : null;
  if (reply.salesAngle && !salesAngle) dropped += 1;
  if (whyNow.length === 0) throw new Error("no 'why now' line cited the public facts; nothing shown rather than an unsupported brief");
  // Goal and audience carry no citations, so they may carry no number the evidence does not.
  const evidence = [...facts, ...own].map((e) => e.text).join(" ");
  const plain = (text: string) => {
    if (numbers(text).every((n) => evidence.includes(n))) return text;
    dropped += 1;
    return "";
  };
  const steps = reply.steps.map((st) => ({ when: st.when, what: cleanIds(st.what) }));
  return { goal: plain(reply.goal), audience: plain(reply.audience), whyNow, fit, salesAngle, steps, dropped };
}
