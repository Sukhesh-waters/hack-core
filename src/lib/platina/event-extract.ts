/**
 * Event extraction (campaign intelligence C4): conference pages and
 * companies' own posts -> dated events + who is there, each with its proof.
 *
 * The model's job is narrow: name the events a text is about and COPY the
 * words that give the date and place. Code then checks those words are in
 * the text (a date the page does not state is dropped, not trusted) and
 * parses them (lib/platina/events.ts). A conference page the model fails on
 * still yields its event by pattern: page title + the first date on the page.
 *
 * Idempotent: events upsert on (workspace, key), participants on their proof.
 */
import { z } from "zod";
import type { PlatinaSignalMetrics } from "@/db/platina-schema";
import { markdownToText } from "@/lib/scrape/site";
import { extractJson } from "./json";
import {
  brandsOnEventPage,
  countryOf,
  eventKey,
  findDateRanges,
  nameTokens,
  parseDateRange,
  quotedIn,
  sameEvent,
  type ParticipationEvidence,
} from "./events";

/** How far back a pass reads collected documents. */
export const EVENT_LOOKBACK_DAYS = 120;
/** Characters of a conference page the model reads — the headline block. */
export const PAGE_CHARS = 4_000;
const POST_CHARS = 700;
const PAGES_PER_CALL = 3;
const POSTS_PER_CALL = 12;

/** A post worth asking about: it names a gathering. */
export const EVENT_HINT =
  /\b(conference|congress|expo|exhibition|summit|symposium|booth|stand\s+[a-z]?\d|trade (fair|show)|meeting|webinar|workshop|forum|join us|visit us|meet us)\b/i;

export type EventSourceDoc = {
  id: string;
  brandId: string | null;
  sourceKind: string | null;
  sourceUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  body: string;
  metrics: PlatinaSignalMetrics | null;
  fetchedAt: Date;
};

export type KnownEvent = { eventKey: string; name: string; startsOn: string | null; country: string | null };

export type EventRow = {
  workspaceId: string;
  eventKey: string;
  name: string;
  format: "in_person" | "online";
  startsOn: string | null;
  endsOn: string | null;
  dateText: string | null;
  location: string | null;
  country: string | null;
  sourceUrl: string;
  documentId: string;
  detail: Record<string, unknown> | null;
};

export type ParticipantRow = {
  workspaceId: string;
  eventId: string;
  brandId: string;
  evidence: ParticipationEvidence;
  sourceUrl: string;
  documentId: string;
  excerpt: string | null;
  observedAt: Date;
};

export type EventExtractDeps = {
  listDocs: (workspaceId: string, since: Date) => Promise<EventSourceDoc[]>;
  listBrands: (workspaceId: string) => Promise<{ id: string; name: string }[]>;
  listEvents: (workspaceId: string) => Promise<KnownEvent[]>;
  ask: (prompt: string) => Promise<string>;
  upsertEvent: (row: EventRow) => Promise<string>;
  insertParticipants: (rows: ParticipantRow[]) => Promise<number>;
};

// ---------------------------------------------------------------------------
// Prompt and reply
// ---------------------------------------------------------------------------

type Item = { doc: EventSourceDoc; text: string; kind: "page" | "post"; reference: Date; who: string | null };

export function buildEventPrompt(items: Pick<Item, "text" | "kind" | "reference" | "who">[]): string {
  return [
    "Below are numbered texts: event web pages and company social posts.",
    "For each text, list the named events it announces or describes: conferences, trade fairs, symposia, workshops, user meetings, webinars.",
    'For each event give: "name" (the event\'s own short name), "date" (copy the date words EXACTLY as the text writes them, or null), "location" (copy the place words EXACTLY, "online" for a webinar, or null), "format" ("in_person" or "online"), and for posts "role": "participating" when the posting company says it will be (or was) there — exhibiting, a booth, speaking, hosting, attending — otherwise "mention".',
    "Skip product launches, awards, charity runs, and invitations that name no event. An event page that lists several events: list each one. Never guess a date or a place that the text does not state.",
    'Reply with JSON only: {"items":[{"i":number,"events":[{"name":string,"date":string|null,"location":string|null,"format":"in_person"|"online","role":"participating"|"mention"|null}]}]}',
    ...items.map(
      (item, i) =>
        `[${i}] (${item.kind === "page" ? "event page" : `post by ${item.who ?? "a company"}, ${item.reference.toISOString().slice(0, 10)}`}) ${item.text}`,
    ),
  ].join("\n\n");
}

const replySchema = z.object({
  items: z.array(
    z.object({
      i: z.number().int(),
      events: z
        .array(
          z.object({
            name: z.string(),
            date: z.string().nullable().optional(),
            location: z.string().nullable().optional(),
            format: z.string().nullable().optional(),
            role: z.string().nullable().optional(),
          }),
        )
        .default([]),
    }),
  ),
});

export type ExtractedEvent = {
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  dateText: string | null;
  location: string | null;
  country: string | null;
  format: "in_person" | "online";
  participating: boolean;
  /** The model quoted a date the text does not contain. */
  rejectedDate?: string;
  via: "model" | "pattern";
};

/**
 * The model's events for one text, kept only where they are grounded: the
 * name shares a word with the text, the date words and place words are in
 * the text. An ungrounded date is dropped (the event stays, undated).
 */
export function groundEvents(
  raw: { name: string; date?: string | null; location?: string | null; format?: string | null; role?: string | null }[],
  text: string,
  reference: Date,
): ExtractedEvent[] {
  const lower = text.toLowerCase();
  const out: ExtractedEvent[] = [];
  for (const e of raw) {
    const name = e.name.replace(/\s+/g, " ").trim();
    const tokens = nameTokens(name);
    if (name.length < 3 || name.length > 90 || tokens.length === 0) continue;
    if (!tokens.some((t) => lower.includes(t))) continue;
    const online = e.format === "online" || /^online$/i.test(e.location ?? "");
    let startsOn: string | null = null;
    let endsOn: string | null = null;
    let dateText: string | null = null;
    let rejectedDate: string | undefined;
    if (e.date) {
      const range = quotedIn(e.date, text) ? parseDateRange(e.date, reference) : null;
      if (range) {
        ({ startsOn, endsOn } = range);
        dateText = e.date.trim();
      } else {
        rejectedDate = e.date;
      }
    }
    const location =
      e.location && !/^online$/i.test(e.location) && quotedIn(e.location, text) ? e.location.trim() : null;
    out.push({
      name,
      startsOn,
      endsOn,
      dateText,
      location,
      country: countryOf(location),
      format: online ? "online" : "in_person",
      participating: e.role === "participating",
      ...(rejectedDate ? { rejectedDate } : {}),
      via: "model",
    });
  }
  return out;
}

/** Parse a batch reply into grounded events per item. Unparseable -> null. */
export function parseEventReply(raw: string, items: Pick<Item, "text" | "reference">[]): ExtractedEvent[][] | null {
  const parsed = replySchema.safeParse(extractJson(raw));
  if (!parsed.success) return null;
  const out: ExtractedEvent[][] = items.map(() => []);
  for (const item of parsed.data.items) {
    if (item.i < 0 || item.i >= items.length) continue;
    out[item.i] = groundEvents(item.events, items[item.i].text, items[item.i].reference);
  }
  return out;
}

/**
 * An event page read without the model: its title names the event, the first
 * date range near the top dates it. Better than losing a whole page to one
 * failed model call.
 */
export function eventFromPagePattern(title: string | null, text: string): ExtractedEvent | null {
  const name = (title ?? "").split(/\s[|–—-]\s|\s\|\s?/)[0].replace(/\s+/g, " ").trim();
  if (nameTokens(name).length === 0) return null;
  const range = findDateRanges(text.slice(0, 3_000))[0] ?? null;
  return {
    name,
    startsOn: range?.startsOn ?? null,
    endsOn: range?.endsOn ?? null,
    dateText: range?.text ?? null,
    location: null,
    country: null,
    format: "in_person",
    participating: false,
    via: "pattern",
  };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

function toItem(doc: EventSourceDoc, brandNames: Map<string, string>): Item | null {
  if (doc.sourceKind === "conference") {
    return {
      doc,
      kind: "page",
      text: markdownToText(doc.body).slice(0, PAGE_CHARS),
      reference: doc.fetchedAt,
      who: null,
    };
  }
  if (doc.sourceKind === "social_posts" && EVENT_HINT.test(doc.body)) {
    const posted = doc.metrics?.postedAt ? new Date(doc.metrics.postedAt) : doc.fetchedAt;
    return {
      doc,
      kind: "post",
      text: doc.body.replace(/\s+/g, " ").slice(0, POST_CHARS),
      reference: Number.isNaN(posted.getTime()) ? doc.fetchedAt : posted,
      who: doc.brandId ? (brandNames.get(doc.brandId) ?? null) : null,
    };
  }
  return null;
}

export type EventExtractResult = {
  status: "done" | "no_documents";
  documents: number;
  events: number;
  participants: number;
  rejectedDates: number;
  failedBatches: number;
};

export async function extractEventsForWorkspace(
  deps: EventExtractDeps,
  input: { workspaceId: string; now?: Date; lookbackDays?: number },
): Promise<EventExtractResult> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (input.lookbackDays ?? EVENT_LOOKBACK_DAYS) * 86_400_000);
  const [docs, brands, known] = await Promise.all([
    deps.listDocs(input.workspaceId, since),
    deps.listBrands(input.workspaceId),
    deps.listEvents(input.workspaceId),
  ]);
  const brandNames = new Map(brands.map((b) => [b.id, b.name]));
  const items = docs.map((d) => toItem(d, brandNames)).filter((i): i is Item => i !== null);
  const result: EventExtractResult = {
    status: items.length === 0 ? "no_documents" : "done",
    documents: items.length,
    events: 0,
    participants: 0,
    rejectedDates: 0,
    failedBatches: 0,
  };
  if (items.length === 0) return result;

  // Pages and posts go in separate batches: a 4,000-character page and twelve
  // short posts are different prompt sizes.
  const batches: Item[][] = [];
  const pages = items.filter((i) => i.kind === "page");
  const posts = items.filter((i) => i.kind === "post");
  for (let k = 0; k < pages.length; k += PAGES_PER_CALL) batches.push(pages.slice(k, k + PAGES_PER_CALL));
  for (let k = 0; k < posts.length; k += POSTS_PER_CALL) batches.push(posts.slice(k, k + POSTS_PER_CALL));

  const events: { item: Item; found: ExtractedEvent[] }[] = [];
  for (const batch of batches) {
    let found: ExtractedEvent[][] | null = null;
    try {
      found = parseEventReply(await deps.ask(buildEventPrompt(batch)), batch);
    } catch {
      found = null;
    }
    if (!found) {
      result.failedBatches += 1;
      found = batch.map((item) => {
        if (item.kind !== "page") return [];
        const fallback = eventFromPagePattern(item.doc.title, item.text);
        return fallback ? [fallback] : [];
      });
    }
    batch.forEach((item, k) => events.push({ item, found: found![k] }));
  }

  const seen: KnownEvent[] = [...known];
  const participants: ParticipantRow[] = [];
  for (const { item, found } of events) {
    const proofUrl = item.doc.canonicalUrl ?? item.doc.sourceUrl;
    const ids: string[] = [];
    for (const e of found) {
      if (e.rejectedDate) result.rejectedDates += 1;
      const year = e.startsOn ? +e.startsOn.slice(0, 4) : item.kind === "post" ? item.reference.getUTCFullYear() : null;
      const match = seen.find((k) =>
        sameEvent(
          { name: e.name, year, country: e.country },
          { name: k.name, year: k.startsOn ? +k.startsOn.slice(0, 4) : null, country: k.country },
        ),
      );
      const key = match?.eventKey ?? eventKey(e.name, year);
      const id = await deps.upsertEvent({
        workspaceId: input.workspaceId,
        eventKey: key,
        name: match?.name ?? e.name,
        format: e.format,
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        dateText: e.dateText,
        location: e.location,
        country: e.country,
        sourceUrl: proofUrl,
        documentId: item.doc.id,
        detail: item.kind === "page" ? { via: e.via, readAt: item.doc.fetchedAt.toISOString() } : null,
      });
      if (!match) seen.push({ eventKey: key, name: e.name, startsOn: e.startsOn, country: e.country });
      result.events += 1;
      ids.push(id);
      if (item.kind === "post" && e.participating && item.doc.brandId) {
        participants.push({
          workspaceId: input.workspaceId,
          eventId: id,
          brandId: item.doc.brandId,
          evidence: "announced_in_post",
          sourceUrl: proofUrl,
          documentId: item.doc.id,
          excerpt: item.text.slice(0, 240),
          observedAt: item.reference,
        });
      }
    }
    // Names on an event page count only when the page is about ONE event —
    // on a listing page there is no telling which event a sponsor belongs to.
    if (item.kind === "page" && ids.length === 1) {
      const page = { url: proofUrl, title: item.doc.title, markdown: item.doc.body };
      for (const hit of brandsOnEventPage(page, brands)) {
        participants.push({
          workspaceId: input.workspaceId,
          eventId: ids[0],
          brandId: hit.brandId,
          evidence: hit.evidence,
          sourceUrl: proofUrl,
          documentId: item.doc.id,
          excerpt: hit.excerpt,
          observedAt: item.doc.fetchedAt,
        });
      }
    }
  }
  result.participants = await deps.insertParticipants(participants);
  return result;
}
