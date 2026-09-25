import * as cheerio from "cheerio";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  ScrapeError,
  firecrawlConfigured,
  isUnsupportedByFirecrawl,
  scrapeWithFirecrawl,
} from "@/lib/scrape/firecrawl";
import { markdownToText } from "@/lib/scrape/site";
import { safeFetch } from "@/lib/net/safe-fetch";

/**
 * Pure text extraction + chunking for the Brand Gene Knowledge tab's
 * URL-ingest pipeline. Impure fetch stays isolated to fetchPage() so
 * everything else here is fully unit-tested.
 */

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 2_000_000; // 2 MB cap on downloaded HTML
export const MAX_SOURCE_CHARS = 40_000; // cap extracted text before chunking
export const MIN_EXTRACT_CHARS = 200; // below this, treat as unusable
export const MAX_CHUNK_CHARS = 1_200;
export const CHUNK_OVERLAP_CHARS = 150;

const STRIP_SELECTORS = "script, style, nav, header, footer, aside, noscript";

export function extractReadableText(html: string): {
  title: string | null;
  text: string;
} {
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS).remove();
  const title = $("title").first().text().trim() || null;
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { title, text };
}

export function chunkText(
  text: string,
  opts?: { maxChars?: number; overlapChars?: number },
): string[] {
  const maxChars = opts?.maxChars ?? MAX_CHUNK_CHARS;
  const overlapChars = opts?.overlapChars ?? CHUNK_OVERLAP_CHARS;
  const paragraphs = text
    .split(/\n{2,}|(?<=\.)\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const flat = paragraphs.length > 0 ? paragraphs : [text.trim()].filter(Boolean);
  if (flat.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
  };

  for (const paragraph of flat) {
    let remaining = paragraph;
    while (remaining.length > maxChars) {
      // Hard-split a single oversized paragraph into windows.
      pushCurrent();
      chunks.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
      current = "";
    }
    if ((current + " " + remaining).trim().length > maxChars) {
      pushCurrent();
      const overlap = current.slice(-overlapChars);
      current = `${overlap} ${remaining}`.trim();
    } else {
      current = `${current} ${remaining}`.trim();
    }
  }
  pushCurrent();

  return chunks;
}

export async function fetchPage(
  url: string,
): Promise<{ html: string; contentType: string }> {
  // safeFetch refuses private/internal addresses on every redirect hop and
  // stops reading at the byte cap (C7.0 SSRF guard).
  const response = await safeFetch(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    headers: { "user-agent": "PlatinaAI-KnowledgeIngest/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error("Only HTML pages are supported in this slice.");
  }
  const html = await response.text();
  return { html, contentType };
}

// ---------------------------------------------------------------------------
// readPage — the one entry point: own fetch and Firecrawl, in either order
// ---------------------------------------------------------------------------

// markdownToText lives with the other page-reading helpers in the shared
// scrape module (Platina uses it too); re-exported for existing callers.
export { markdownToText } from "@/lib/scrape/site";

export type ReadPageResult = {
  title: string | null;
  text: string;
  via: "direct" | "firecrawl";
};

type Reader = (url: string) => Promise<{ title: string | null; text: string }>;

const readDirect: Reader = async (url) => {
  const { html } = await fetchPage(url);
  return extractReadableText(html);
};

const readFirecrawl: Reader = async (url) => {
  const page = await scrapeWithFirecrawl(url);
  return { title: page.title ?? null, text: markdownToText(page.markdown) };
};

/**
 * Reads one page for the knowledge base, trying two readers in order:
 *
 *   prefer "firecrawl" (a person is waiting — paste-a-URL): Firecrawl first.
 *     It renders JavaScript and gets past most bot walls — the pages our
 *     own fetch cannot read at all. 1 credit.
 *   prefer "direct" (background refresh): our own fetch first — free — and
 *     Firecrawl only when that is blocked, empty or a JavaScript shell.
 *
 * A reader "fails" on an error OR on too little text (a login wall or a React
 * shell is not a page). When both fail, the error names both reasons, so the
 * person sees "blocked (403); Firecrawl credits used up" rather than
 * "Something went wrong".
 */
export async function readPage(
  url: string,
  options: {
    prefer?: "direct" | "firecrawl";
    readers?: { direct?: Reader; firecrawl?: Reader };
    firecrawlAvailable?: boolean;
  } = {},
): Promise<ReadPageResult> {
  const direct = options.readers?.direct ?? readDirect;
  const firecrawl = options.readers?.firecrawl ?? readFirecrawl;
  const firecrawlOk =
    (options.firecrawlAvailable ?? firecrawlConfigured()) && !isUnsupportedByFirecrawl(url);

  const plan: { via: ReadPageResult["via"]; read: Reader }[] =
    options.prefer === "firecrawl"
      ? [
          ...(firecrawlOk ? [{ via: "firecrawl" as const, read: firecrawl }] : []),
          { via: "direct" as const, read: direct },
        ]
      : [
          { via: "direct" as const, read: direct },
          ...(firecrawlOk ? [{ via: "firecrawl" as const, read: firecrawl }] : []),
        ];

  const reasons: string[] = [];
  for (const step of plan) {
    try {
      const { title, text } = await step.read(url);
      if (text.length >= MIN_EXTRACT_CHARS) return { title, text, via: step.via };
      reasons.push(
        step.via === "direct"
          ? "the page has too little readable text (a JavaScript app or a login wall)"
          : "Firecrawl found too little readable text",
      );
    } catch (error) {
      reasons.push(actionErrorMessage(error).replace(/\.$/, ""));
    }
  }

  const social = isUnsupportedByFirecrawl(url)
    ? " Social profiles can't be read from a URL — use the social connectors instead."
    : "";
  throw new ScrapeError(`Couldn't read that page: ${reasons.join("; ")}.${social}`, false);
}

/**
 * An ingest runs inside one request and takes a few seconds. A row still
 * "pending" long after that was orphaned — the request died (a dev-server
 * restart after an .env change, a deploy, a crash) before it could write
 * "ready" or "failed". Shown as interrupted instead of "Ingesting…" forever.
 */
export const INGEST_ORPHAN_AFTER_MS = 3 * 60_000;

/** Written on a pending row the refresh job closes after INGEST_ORPHAN_AFTER_MS. */
export const INTERRUPTED_REASON = "Interrupted before it finished (the server restarted). Ingest it again.";

export function ingestDisplayStatus(
  source: { status: string; createdAt: Date | string | null },
  now: Date = new Date(),
): "ready" | "failed" | "pending" | "interrupted" {
  if (source.status === "ready" || source.status === "failed") return source.status;
  const created = source.createdAt ? new Date(source.createdAt).getTime() : NaN;
  if (Number.isFinite(created) && now.getTime() - created > INGEST_ORPHAN_AFTER_MS) {
    return "interrupted";
  }
  return "pending";
}
