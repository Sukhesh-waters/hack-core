import { inngest } from "@/inngest/client";
import {
  insertEventParticipants,
  listBrands,
  listEventSourceDocs,
  listEvents,
  upsertEvent,
} from "@/db/queries/platina";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { routeAI } from "@/lib/ai/router";
import { extractEventsForWorkspace, type EventExtractDeps } from "@/lib/platina/event-extract";
import { syncEventInsights } from "@/lib/platina/market-insight-sync";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * A pass reads only recently collected documents: the job runs after every
 * conference/post collection and daily, so older ones were already read.
 * scripts/events-report.ts --extract --days N re-reads further back.
 */
export const EVENT_JOB_LOOKBACK_DAYS = 3;

const deps: EventExtractDeps = {
  listDocs: (ws, since) => listEventSourceDocs(ws, since),
  listBrands: async (ws) => (await listBrands(ws)).map((b) => ({ id: b.id, name: b.name })),
  listEvents: async (ws) =>
    (await listEvents(ws)).map((e) => ({ eventKey: e.eventKey, name: e.name, startsOn: e.startsOn, country: e.country })),
  ask: (prompt) => routeAI({ kind: "chat", tier: "fast", json: true, prompt }),
  upsertEvent: (row) => upsertEvent(row),
  insertParticipants: (rows) => insertEventParticipants(rows),
};

/**
 * Event extraction (campaign intelligence C4): conference pages and posts ->
 * dated events and who is at them. Per workspace; idempotent.
 */
export const platinaEventExtract = inngest.createFunction(
  {
    id: "platina-event-extract",
    triggers: [{ event: "platina/events.extract.requested" }, { cron: "45 4 * * *" }],
    concurrency: { key: "event.data.workspaceId", limit: 1 },
    debounce: { key: "event.data.workspaceId", period: "2m" },
  },
  async ({ event, step }) => {
    const data = (event?.data ?? {}) as { workspaceId?: string };
    const workspaceIds =
      typeof data.workspaceId === "string"
        ? [data.workspaceId]
        : await step.run("list-workspaces", () => listAllWorkspaceIds());
    const results: Record<string, unknown> = {};
    for (const ws of workspaceIds) {
      const extracted = await step.run(`events-${ws}`, () =>
        extractEventsForWorkspace(deps, { workspaceId: ws, lookbackDays: EVENT_JOB_LOOKBACK_DAYS }),
      );
      if (extracted.events > 0) await step.run(`announce-events-${ws}`, () => broadcastPlatinaSignal(ws, "events"));
      // Upcoming events into the Brain, so plans and ideation retrieve them (C5).
      const insights = await step.run(`event-insights-${ws}`, () => syncEventInsights(ws));
      results[ws] = { extracted, insights };
    }
    return results;
  },
);
