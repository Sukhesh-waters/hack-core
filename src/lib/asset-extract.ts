import Papa from "papaparse";
import { extractText } from "unpdf";

export const MIN_EXTRACT_CHARS = 50;
export const MAX_SOURCE_CHARS = 40_000;

const INGESTIBLE_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.ms-excel",
  "application/pdf",
]);

function normalizeMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function isIngestibleMime(mime: string): boolean {
  return INGESTIBLE_MIMES.has(normalizeMime(mime));
}

/**
 * Parses CSV raw text into readable semantic sentences suitable for embeddings.
 */
function formatCsvText(rawText: string): string {
  const parsed = Papa.parse<string[]>(rawText, {
    skipEmptyLines: true,
  });

  if (!parsed.data || parsed.data.length === 0) return "";

  const [header, ...rows] = parsed.data;
  if (rows.length === 0) {
    return header.join(", ");
  }

  const lines: string[] = [];
  for (const row of rows) {
    const pairs: string[] = [];
    for (let i = 0; i < row.length; i++) {
      const col = header[i]?.trim();
      const val = row[i]?.trim();
      if (val) {
        pairs.push(col ? `${col}: ${val}` : val);
      }
    }
    if (pairs.length > 0) {
      lines.push(pairs.join(" | "));
    }
  }

  return lines.join("\n");
}

/**
 * Extracts readable plain text from a supported file buffer.
 * Caps at MAX_SOURCE_CHARS to protect downstream embedding costs.
 */
export async function extractTextFromAsset(
  buffer: ArrayBuffer,
  mime: string,
  filename: string,
): Promise<string> {
  const normMime = normalizeMime(mime);
  if (!isIngestibleMime(normMime)) {
    throw new Error(
      `"${filename}" cannot be ingested. Only documents and data files (PDF, Markdown, CSV, plain text) are supported.`,
    );
  }

  let text = "";

  if (normMime === "application/pdf") {
    const uint8 = new Uint8Array(buffer);
    const pdfResult = await extractText(uint8);
    // unpdf returns { text: string[], totalPages: number }
    text = Array.isArray(pdfResult.text)
      ? pdfResult.text.join("\n\n").trim()
      : String(pdfResult.text || "").trim();
  } else if (normMime === "text/csv" || normMime === "application/vnd.ms-excel") {
    const raw = new TextDecoder("utf-8").decode(buffer);
    text = formatCsvText(raw);
  } else {
    // text/plain, text/markdown
    text = new TextDecoder("utf-8").decode(buffer).trim();
  }

  // Clean excessive whitespace
  const cleaned = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();

  if (cleaned.length < MIN_EXTRACT_CHARS) {
    throw new Error(
      `"${filename}" contains too little readable text to ingest (minimum ${MIN_EXTRACT_CHARS} characters).`,
    );
  }

  return cleaned.slice(0, MAX_SOURCE_CHARS);
}
