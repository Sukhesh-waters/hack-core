import * as cheerio from "cheerio";

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
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "InstaMediaAI-KnowledgeIngest/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error("Only HTML pages are supported in this slice.");
  }
  const html = await response.text();
  return { html: html.slice(0, MAX_RESPONSE_BYTES), contentType };
}
