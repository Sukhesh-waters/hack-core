import { describe, expect, it } from "vitest";
import {
  buildEventPrompt,
  eventFromPagePattern,
  extractEventsForWorkspace,
  groundEvents,
  parseEventReply,
  type EventExtractDeps,
  type EventRow,
  type EventSourceDoc,
  type ParticipantRow,
} from "./event-extract";

const posted = new Date("2026-09-10T00:00:00Z");

describe("groundEvents — the model points, the text decides", () => {
  const text = "Join Waters at the SOFT/TIAFT Joint Meeting in Chicago. Stop by Booth #800 on September 27-30.";

  it("keeps a quoted date and place and parses them", () => {
    const [e] = groundEvents(
      [{ name: "SOFT/TIAFT Joint Meeting", date: "September 27-30", location: "Chicago", format: "in_person", role: "participating" }],
      text,
      posted,
    );
    expect(e).toMatchObject({
      startsOn: "2026-09-27",
      endsOn: "2026-09-30",
      location: "Chicago",
      country: "US",
      participating: true,
      format: "in_person",
    });
  });

  it("drops a date the text does not state, keeping the event undated", () => {
    const [e] = groundEvents([{ name: "SOFT/TIAFT Joint Meeting", date: "October 4-8, 2026", location: "Denver" }], text, posted);
    expect(e).toMatchObject({ startsOn: null, dateText: null, location: null, rejectedDate: "October 4-8, 2026" });
  });

  it("drops an event whose name is nowhere in the text", () => {
    expect(groundEvents([{ name: "Pittcon 2027" }], text, posted)).toEqual([]);
  });

  it("reads a webinar as online", () => {
    const [e] = groundEvents(
      [{ name: "Technology Networks webinar", date: "Sept 22nd", location: "online", format: "online", role: "participating" }],
      "Technology Networks webinar alert! Sept 22nd, 10AM EDT",
      posted,
    );
    expect(e).toMatchObject({ format: "online", location: null, startsOn: "2026-09-22" });
  });
});

describe("parseEventReply", () => {
  it("returns null for a derailed reply so the caller can fall back", () => {
    expect(parseEventReply("Sure! Here are the events I found...", [{ text: "x", reference: posted }])).toBeNull();
  });

  it("ignores out-of-range items", () => {
    const reply = JSON.stringify({ items: [{ i: 5, events: [{ name: "X" }] }] });
    expect(parseEventReply(reply, [{ text: "x", reference: posted }])).toEqual([[]]);
  });
});

describe("eventFromPagePattern", () => {
  it("names the event from the page title and dates it from the headline", () => {
    expect(
      eventFromPagePattern("ARABLAB LIVE 2026 | Dubai World Trade Centre", "ARABLAB LIVE\n26-28 October 2026 Dubai World Trade Centre"),
    ).toMatchObject({ name: "ARABLAB LIVE 2026", startsOn: "2026-10-26", via: "pattern" });
  });
});

describe("buildEventPrompt", () => {
  it("tells the model to copy, not guess, and says who posted", () => {
    const prompt = buildEventPrompt([{ text: "Join us", kind: "post", reference: posted, who: "SCIEX" }]);
    expect(prompt).toContain("EXACTLY");
    expect(prompt).toContain("Never guess");
    expect(prompt).toContain("post by SCIEX, 2026-09-10");
  });
});

describe("extractEventsForWorkspace", () => {
  const brands = [
    { id: "waters", name: "Waters" },
    { id: "agilent", name: "Agilent" },
    { id: "sciex", name: "SCIEX" },
  ];
  const arablab: EventSourceDoc = {
    id: "d1",
    brandId: null,
    sourceKind: "conference",
    sourceUrl: "https://www.arablab.com/",
    canonicalUrl: "https://www.terrapinn.com/exhibition/arablab-live/",
    title: "ARABLAB LIVE 2026 | Dubai World Trade Centre",
    body: "# ARABLAB LIVE\n#### **26-28 October 2026**   Dubai World Trade Centre\n## 2026 Sponsors & Exhibitors\n[![Agilent at ARABLAB LIVE 2026](https://cdn/a.png)](https://x)",
    metrics: null,
    fetchedAt: new Date("2026-09-21T10:00:00Z"),
  };
  const post: EventSourceDoc = {
    id: "d2",
    brandId: "sciex",
    sourceKind: "social_posts",
    sourceUrl: "https://www.linkedin.com/posts/sciex-1",
    canonicalUrl: null,
    title: null,
    body: "Visit SCIEX at Arablab Live in Dubai, stand 4",
    metrics: { postedAt: "2026-09-15T00:00:00Z" },
    fetchedAt: new Date("2026-09-21T10:00:00Z"),
  };
  const unrelated: EventSourceDoc = { ...post, id: "d3", body: "Our Q3 results are in." };

  function harness(reply: (prompt: string) => string) {
    const events: EventRow[] = [];
    const people: ParticipantRow[] = [];
    const prompts: string[] = [];
    const deps: EventExtractDeps = {
      listDocs: async () => [arablab, post, unrelated],
      listBrands: async () => brands,
      listEvents: async () => [],
      ask: async (p) => {
        prompts.push(p);
        return reply(p);
      },
      upsertEvent: async (row) => {
        events.push(row);
        return `id:${row.eventKey}`;
      },
      insertParticipants: async (rows) => {
        people.push(...rows);
        return rows.length;
      },
    };
    return { deps, events, people, prompts };
  }

  it("merges the page and the post into one event with two proofs", async () => {
    const h = harness((p) =>
      p.includes("(event page)")
        ? JSON.stringify({ items: [{ i: 0, events: [{ name: "ARABLAB LIVE 2026", date: "26-28 October 2026", location: "Dubai World Trade Centre", format: "in_person" }] }] })
        : JSON.stringify({ items: [{ i: 0, events: [{ name: "Arablab Live", date: null, location: "Dubai", format: "in_person", role: "participating" }] }] }),
    );
    const result = await extractEventsForWorkspace(h.deps, { workspaceId: "ws", now: new Date("2026-09-21T12:00:00Z") });

    expect(h.prompts).toHaveLength(2); // the unrelated post never reaches the model
    expect(new Set(h.events.map((e) => e.eventKey))).toEqual(new Set(["arablab-2026"]));
    expect(h.events[0]).toMatchObject({ startsOn: "2026-10-26", country: "AE", sourceUrl: "https://www.terrapinn.com/exhibition/arablab-live/" });
    expect(h.people.map((p) => [p.brandId, p.evidence])).toEqual(
      expect.arrayContaining([
        ["agilent", "listed_exhibitor"],
        ["sciex", "announced_in_post"],
      ]),
    );
    expect(h.people.some((p) => p.brandId === "waters")).toBe(false);
    expect(result).toMatchObject({ status: "done", documents: 2, participants: 2, failedBatches: 0 });
  });

  it("still dates the event page when the model derails", async () => {
    const h = harness(() => "I cannot help with that.");
    const result = await extractEventsForWorkspace(h.deps, { workspaceId: "ws", now: new Date("2026-09-21T12:00:00Z") });
    expect(result.failedBatches).toBe(2);
    expect(h.events).toEqual([expect.objectContaining({ eventKey: "arablab-2026", startsOn: "2026-10-26" })]);
  });

  it("does nothing without documents", async () => {
    const h = harness(() => "{}");
    h.deps.listDocs = async () => [];
    expect((await extractEventsForWorkspace(h.deps, { workspaceId: "ws" })).status).toBe("no_documents");
    expect(h.prompts).toHaveLength(0);
  });
});
