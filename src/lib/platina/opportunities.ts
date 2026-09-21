/**
 * Opportunities (campaign intelligence C5) — pure. Turns measured interest,
 * competitor pressure and the events calendar into the suggestion page, in
 * the order the owner asked for:
 *
 *   1. What people are interested in now  (insights, each with its proof)
 *   2. Campaigns to run                   (online topics, in-person/online events)
 *   3. Plan                               (the planner, started from one of the above)
 *   4. Creative                           (last; generated on demand)
 *
 * Ordering is by stated rules, not an invented score: a number shown here is
 * always one that was measured (an engagement index, days an ad has run, days
 * to an event) and always sits next to its source link. Below the min-N gate
 * a topic says "not enough posts yet" and is never proposed as a campaign.
 */
import { daysUntil, eventTiming, GCC_COUNTRIES } from "./events";
import type { TopicMomentum } from "./interest";

/** Events closer than this are listed as short notice, ranked after the rest. */
export const MIN_LEAD_DAYS = 21;
/** How far ahead the event list looks. */
export const EVENT_HORIZON_DAYS = 365;
export const MAX_TOPIC_CAMPAIGNS = 5;
export const MAX_EVENT_CAMPAIGNS = 8;

export type Proof = { label: string; url?: string };

export type Insight = {
  topic: string;
  /** Sold by the client (its own topic list) or a theme the market raised. */
  origin: "client_topic" | "market_theme";
  status: "ok" | "insufficient";
  n: number;
  headline: string;
  proofs: Proof[];
};

export type PlanStart =
  | { useCase: "client"; goal: string }
  | { useCase: "event"; eventName: string; eventDate: string };

export type Campaign = {
  key: string;
  channel: "online" | "in_person";
  source: "topic" | "event";
  title: string;
  why: string[];
  proofs: Proof[];
  /** "in 35 days", "short notice: in 9 days". */
  timing: string | null;
  plan: PlanStart;
  /** Seed for on-demand creative drafting. */
  creativeTopic: string;
};

export type OpportunityEvent = {
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
  detail: unknown;
  participants: { brandId: string; evidence: string; sourceUrl: string }[];
};

export type OpportunityInput = {
  client: { id: string; name: string; region: string | null; topics: string[] };
  competitors: { id: string; name: string }[];
  /** topicMomentum() over the client's and its competitors' signals. */
  momentum: TopicMomentum[];
  /** Proof URL -> the brand whose post/ad it is, for "who" in proofs. */
  proofOwner: Map<string, string | null>;
  events: OpportunityEvent[];
  now: Date;
};

const inDays = (n: number) => `in ${n} day${n === 1 ? "" : "s"}`;

/**
 * The company whose own event this is: "SCIEX Summit 2026" is SCIEX's,
 * "Waters Inform User Meeting" is Waters'. Matched on the full name or its
 * first word (4+ letters: "Thermo" for Thermo Fisher Scientific).
 */
export function hostOf(eventName: string, brands: { id: string; name: string }[]): string | null {
  const hay = ` ${eventName.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const b of brands) {
    const full = b.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const first = full.split(" ")[0];
    if (hay.includes(` ${full} `) || (first.length >= 4 && hay.includes(` ${first} `))) return b.id;
  }
  return null;
}

const fmt = (x: number) => (Math.round(x * 100) / 100).toString();
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Countries a client's region names: "GCC" -> the six, "AE" -> ["AE"]. */
export function homeCountries(region: string | null | undefined): string[] {
  const r = (region ?? "").trim();
  if (!r) return [];
  if (/gcc|gulf|middle east|mena/i.test(r)) return [...GCC_COUNTRIES];
  if (/^[A-Za-z]{2}$/.test(r)) return [r.toUpperCase()];
  return [];
}

/** The 1-3 sentences a campaign's goal line can carry into the planner (<=200 chars). */
function goalLine(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 200 ? one : `${one.slice(0, 197).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// 1. Insights
// ---------------------------------------------------------------------------

export function buildInsights(input: OpportunityInput): Insight[] {
  const names = new Map([[input.client.id, input.client.name], ...input.competitors.map((c) => [c.id, c.name] as [string, string])]);
  const own = new Set(input.client.topics);
  return input.momentum
    .filter((m) => m.signalKind === "interest")
    .map((m) => {
      const origin = own.has(m.topic) ? "client_topic" : "market_theme";
      if (m.status !== "ok") {
        return {
          topic: m.topic,
          origin,
          status: "insufficient",
          n: m.n,
          headline: `${m.n} post${m.n === 1 ? "" : "s"} so far — not enough to say (needs 5)`,
          // One example post, without its number: below the gate no magnitude is shown.
          proofs: m.proofs.slice(0, 1).map((p) => ({ label: "example post", url: p.sourceUrl })),
        } satisfies Insight;
      }
      const now = m.recent ?? m.baseline!;
      const window = m.recent !== null ? "in the last 30 days" : "in the 90 days before that";
      const trend =
        m.recent !== null && m.baseline !== null
          ? `, ${m.change! >= 0 ? "up" : "down"} from ${fmt(m.baseline)}× the 90 days before`
          : "";
      return {
        topic: m.topic,
        origin,
        status: "ok",
        n: m.n,
        headline: `Posts on this drew ${fmt(now)}× their company's typical engagement ${window}${trend} (${m.n} posts)`,
        proofs: m.proofs.map((p) => {
          const who = names.get(input.proofOwner.get(p.sourceUrl) ?? "") ?? "a company";
          return { label: `${who}, ${day(p.observedAt)}: ${fmt(p.value)}× its typical post`, url: p.sourceUrl };
        }),
      } satisfies Insight;
    })
    .sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === "ok" ? -1 : 1) || b.n - a.n,
    );
}

// ---------------------------------------------------------------------------
// 2. Campaigns
// ---------------------------------------------------------------------------

function topicCampaigns(input: OpportunityInput): Campaign[] {
  const names = new Map(input.competitors.map((c) => [c.id, c.name]));
  const own = new Set(input.client.topics);
  const pressure = input.momentum.filter((m) => m.signalKind === "pressure");
  return input.momentum
    .filter((m) => m.signalKind === "interest" && m.status === "ok")
    .map((m) => ({ m, value: m.recent ?? m.baseline ?? 0 }))
    // Above the typical post: the audience leans in on this subject.
    .filter(({ value }) => value >= 1)
    .sort((a, b) => b.value - a.value || b.m.n - a.m.n)
    .slice(0, MAX_TOPIC_CAMPAIGNS)
    .map(({ m, value }) => {
      const why = [
        `Posts on "${m.topic}" drew ${fmt(value)}× their company's typical engagement (${m.n} posts).`,
        own.has(m.topic)
          ? `${input.client.name} sells this — it is on its own site.`
          : `A market theme, not yet on ${input.client.name}'s own topic list.`,
      ];
      const proofs: Proof[] = m.proofs.slice(0, 2).map((p) => ({
        label: `${fmt(p.value)}× typical, ${day(p.observedAt)}`,
        url: p.sourceUrl,
      }));
      for (const p of pressure.filter((x) => x.topic === m.topic)) {
        const top = p.proofs[0];
        if (!top) continue;
        why.push(`Competitors are paying for ads on this${p.region !== "global" ? ` in ${p.region}` : ""} — one has run ${Math.round(top.value)} days.`);
        proofs.push({ label: `ad running ${Math.round(top.value)} days`, url: top.sourceUrl });
      }
      const leader = m.proofs[0] ? names.get(input.proofOwner.get(m.proofs[0].sourceUrl) ?? "") : undefined;
      return {
        key: `topic:${m.topic}`,
        channel: "online",
        source: "topic",
        title: `Online campaign on ${m.topic}`,
        why: leader ? [...why, `The strongest post on it was ${leader}'s.`] : why,
        proofs,
        timing: null,
        plan: {
          useCase: "client",
          goal: goalLine(
            `Online campaign on ${m.topic}: posts on it drew ${fmt(value)}x typical engagement across ${m.n} posts in this market.`,
          ),
        },
        creativeTopic: `${input.client.name}: ${m.topic}`,
      } satisfies Campaign;
    });
}

function eventCampaigns(input: OpportunityInput): Campaign[] {
  const home = new Set(homeCountries(input.client.region));
  const names = new Map([[input.client.id, input.client.name], ...input.competitors.map((c) => [c.id, c.name] as [string, string])]);
  const competitorIds = new Set(input.competitors.map((c) => c.id));
  const EVIDENCE: Record<string, string> = {
    listed_exhibitor: "on the exhibitor list",
    mentioned_on_event_page: "named on the event page",
    announced_in_post: "announced it in a post",
  };

  const rows = input.events
    .filter((e) => e.startsOn && eventTiming(e, input.now) === "upcoming")
    .map((e) => {
      const days = daysUntil(e.startsOn!, input.now);
      const rivals = [...new Map(e.participants.filter((p) => competitorIds.has(p.brandId)).map((p) => [p.brandId, p])).values()];
      const clientThere = e.participants.some((p) => p.brandId === input.client.id);
      const atHome = Boolean(e.country && home.has(e.country));
      const host = hostOf(e.name, [{ id: input.client.id, name: input.client.name }, ...input.competitors]);
      const rivalHosted = host !== null && competitorIds.has(host);
      return { e, days, rivals, clientThere, atHome, host, rivalHosted, leadOk: days >= MIN_LEAD_DAYS };
    })
    .filter((r) => r.days <= EVENT_HORIZON_DAYS);

  rows.sort(
    (a, b) =>
      Number(b.leadOk) - Number(a.leadOk) ||
      // A competitor's own event cannot be joined — it ranks after ones that can.
      Number(a.rivalHosted) - Number(b.rivalHosted) ||
      Number(b.atHome) - Number(a.atHome) ||
      b.rivals.length - a.rivals.length ||
      a.days - b.days,
  );

  return rows.slice(0, MAX_EVENT_CAMPAIGNS).map(({ e, days, rivals, clientThere, atHome, host, rivalHosted, leadOk }) => {
    // A rival's own event is answered online, on the same days.
    const online = e.format === "online" || rivalHosted;
    const where = online ? "online" : e.location ?? e.country ?? "place not stated";
    const why: string[] = [];
    if (atHome) why.push(`In ${input.client.name}'s region (${e.country}).`);
    if (rivalHosted) {
      why.push(
        `${names.get(host!)}'s own event — you cannot take part, but its audience is paying attention those days: counter with an online campaign.`,
      );
    } else if (host === input.client.id) {
      why.push(`${input.client.name}'s own event.`);
    } else if (rivals.length > 0) {
      why.push(
        `${rivals.map((r) => names.get(r.brandId)).join(", ")} ${rivals.length === 1 ? "is" : "are"} going — the audience you compete for will be there.`,
      );
    } else {
      const readAt = (e.detail as { readAt?: string } | null)?.readAt;
      if (readAt) {
        why.push(`No competitor named on the event page read ${readAt.slice(0, 10)} — room to stand out (not proof they will be absent).`);
      }
    }
    if (clientThere && host !== input.client.id) why.push(`${input.client.name} is already going — plan to make it count.`);
    if (!leadOk) why.push(`Short notice: ${inDays(days)} — enough for online follow-up, tight for a stand.`);

    const proofs: Proof[] = [
      { label: e.dateText ? `"${e.dateText}"` : `${e.startsOn}`, url: e.sourceUrl },
      ...rivals.map((r) => ({ label: `${names.get(r.brandId)} ${EVIDENCE[r.evidence] ?? r.evidence}`, url: r.sourceUrl })),
    ];
    return {
      key: `event:${e.eventKey}`,
      channel: online ? "online" : "in_person",
      source: "event",
      title: rivalHosted ? `Counter ${e.name} — online` : `${e.name} — ${where}`,
      why,
      proofs,
      timing: leadOk ? inDays(days) : `short notice: ${inDays(days)}`,
      plan: rivalHosted
        ? {
            useCase: "client",
            goal: goalLine(
              `Online campaign timed to ${e.name} (${e.dateText ?? e.startsOn}), reaching the audience ${names.get(host!)} gathers there.`,
            ),
          }
        : { useCase: "event", eventName: e.name.slice(0, 120), eventDate: e.startsOn! },
      creativeTopic: rivalHosted
        ? `${input.client.name} online counter to ${e.name}`
        : `${input.client.name} at ${e.name}`,
    } satisfies Campaign;
  });
}

/** Event campaigns (ranked by lead time, region, rivals present) and topic campaigns (by measured index). */
export function buildCampaigns(input: OpportunityInput): { events: Campaign[]; topics: Campaign[] } {
  return { events: eventCampaigns(input), topics: topicCampaigns(input) };
}
