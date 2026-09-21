/**
 * Topic assignment for interest signals (C3). The model's only job here is to
 * say what a post or ad is ABOUT, choosing from the client's own topics or
 * naming one short emerging theme. It never produces a number — engagement,
 * the index and momentum are computed in lib/platina/interest.ts.
 *
 * Why emerging themes are allowed: live 2026-09-21 the Waters profile topics
 * were what Waters sells ("liquid chromatography", "mass spectrometry"),
 * while the most-engaged posts in its market were about GLP-1 development,
 * AI lab automation and biopharma summits. A supply-side list alone would
 * miss exactly the interest the owner asked to see. The min-N gate keeps a
 * one-off theme from ranking.
 */
import { z } from "zod";
import { routeAI } from "@/lib/ai/router";
import { extractJson } from "./json";
import { topicsByKeyword } from "./interest";

export const MAX_TOPICS_PER_ITEM = 2;
const BATCH = 20;
const THEME_MAX = 40;

const replySchema = z.object({
  items: z.array(
    z.object({
      i: z.number().int(),
      topics: z.array(z.string()).max(MAX_TOPICS_PER_ITEM).default([]),
      theme: z.string().nullable().optional(),
    }),
  ),
});

export function normaliseTheme(raw: string | null | undefined): string | null {
  const theme = (raw ?? "").toLowerCase().replace(/[^a-z0-9+\- ]+/g, " ").replace(/\s+/g, " ").trim();
  if (theme.length < 3 || theme.length > THEME_MAX) return null;
  if (/^(none|other|general|n\/a|misc)$/.test(theme)) return null;
  return theme;
}

export function buildTopicPrompt(texts: string[], topics: string[]): string {
  return [
    `Topics (the client's subjects, then themes already seen in this market): ${topics.map((t) => `"${t}"`).join(", ")}.`,
    "For each numbered text, list up to 2 topics from the list it is clearly about (exact spelling), and optionally ONE short NEW market theme (2-4 words, e.g. \"glp-1 development\", \"lab automation\") if the text is mainly about something the list does not cover. Use an empty list and null theme for texts about nothing specific (greetings, hiring, awards).",
    'Reply with JSON only: {"items":[{"i":number,"topics":string[],"theme":string|null}]}',
    ...texts.map((t, i) => `[${i}] ${t.replace(/\s+/g, " ").slice(0, 600)}`),
  ].join("\n\n");
}

/** Parses a reply, keeping only topics from the list and well-formed themes. */
export function parseTopicReply(raw: string, count: number, topics: string[]): string[][] {
  const allowed = new Set(topics);
  const out: string[][] = Array.from({ length: count }, () => []);
  const parsed = replySchema.safeParse(extractJson(raw));
  if (!parsed.success) return out;
  for (const item of parsed.data.items) {
    if (item.i < 0 || item.i >= count) continue;
    const chosen = item.topics.map((t) => t.toLowerCase().trim()).filter((t) => allowed.has(t));
    const theme = normaliseTheme(item.theme);
    out[item.i] = [...new Set([...chosen, ...(theme ? [theme] : [])])].slice(0, MAX_TOPICS_PER_ITEM + 1);
  }
  return out;
}

/**
 * Topics for each text: whole-phrase keyword matches first (free, exact),
 * then one model call per batch for everything else. A failed model call
 * leaves those texts topic-less for this pass — never invents a topic.
 */
export async function assignTopics(
  texts: string[],
  topics: string[],
  ask: (prompt: string) => Promise<string> = (prompt) =>
    routeAI({ kind: "chat", tier: "fast", json: true, prompt }),
): Promise<string[][]> {
  const result = texts.map((t) => topicsByKeyword(t, topics).slice(0, MAX_TOPICS_PER_ITEM));
  const pending = result.map((r, i) => (r.length === 0 ? i : -1)).filter((i) => i >= 0);
  for (let start = 0; start < pending.length; start += BATCH) {
    const idx = pending.slice(start, start + BATCH);
    try {
      const reply = await ask(buildTopicPrompt(idx.map((i) => texts[i]), topics));
      parseTopicReply(reply, idx.length, topics).forEach((t, k) => {
        result[idx[k]] = t;
      });
    } catch {
      // Leave them unassigned; the next extraction pass retries.
    }
  }
  return result;
}
