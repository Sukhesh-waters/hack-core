import Papa from "papaparse";
import { z } from "zod";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** Column aliases seen across Meta/Instagram insight exports (lowercased). */
const HEADER_ALIASES = {
  externalId: ["post id", "id", "media id", "post_id"],
  caption: ["caption", "description", "message", "post caption", "text"],
  postedAt: [
    "publish time",
    "posted at",
    "publish date",
    "date",
    "created",
    "timestamp",
  ],
  reach: ["reach", "impressions"],
  likes: ["likes", "like count", "reactions"],
  comments: ["comments", "comment count"],
  shares: ["shares", "share count"],
  saves: ["saves", "saved", "save count"],
} as const;

type CanonicalField = keyof typeof HEADER_ALIASES;

const optionalText = z.preprocess(
  (value) =>
    value === undefined || value === null || String(value).trim() === ""
      ? undefined
      : String(value).trim(),
  z.string().optional(),
);

const optionalCount = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).replace(/,/g, "").trim();
  if (raw === "") return undefined;
  return Number(raw);
}, z.number().int().nonnegative().optional());

const rowSchema = z.object({
  externalId: optionalText,
  caption: optionalText,
  postedAt: z.preprocess((value) => {
    const date = new Date(String(value ?? ""));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }, z.date()),
  reach: optionalCount,
  likes: optionalCount,
  comments: optionalCount,
  shares: optionalCount,
  saves: optionalCount,
});

export type ParsedPostRow = z.infer<typeof rowSchema>;
export type SkippedRow = { line: number; reason: string };
export type CsvParseResult = { rows: ParsedPostRow[]; skipped: SkippedRow[] };

function canonicalizeHeader(header: string): string {
  const needle = header.trim().toLowerCase();
  for (const field of Object.keys(HEADER_ALIASES) as CanonicalField[]) {
    if ((HEADER_ALIASES[field] as readonly string[]).includes(needle)) {
      return field;
    }
  }
  return header;
}

export function parsePostsCsv(csvText: string): CsvParseResult {
  if (csvText.trim() === "") return { rows: [], skipped: [] };

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: canonicalizeHeader,
  });

  const rows: ParsedPostRow[] = [];
  const skipped: SkippedRow[] = [];
  parsed.data.forEach((raw, i) => {
    const line = i + 2; // 1-based, +1 for the header row
    const result = rowSchema.safeParse(raw);
    if (result.success) {
      rows.push(result.data);
    } else {
      const issue = result.error.issues[0];
      skipped.push({
        line,
        reason: `${issue.path.join(".") || "row"}: ${issue.message}`,
      });
    }
  });
  return { rows, skipped };
}
