/**
 * Creative numbers from a pasted spreadsheet (C6 L2/L3). Pure.
 *
 * Two layouts are understood:
 *  - Platina's own: creative (URL or id), captured_at, impressions, reach,
 *    clicks, engagements, saves, shares, video_views, leads, spend.
 *  - LinkedIn page analytics "Update engagement" export: Post link / Update
 *    link, Created date, Impressions, Clicks, Reactions, Comments, Reposts
 *    (engagements = reactions + comments + reposts; reposts count as shares).
 *    LinkedIn's organic API needs partner approval we do not have, so the
 *    export is the connected-account path for now.
 *
 * Strict like the outcomes import: an unknown layout or a bad row is an error
 * with its line number, never a silent partial parse. An empty cell is
 * "not measured" (null), never 0.
 */

export type ImportedMetricRow = {
  /** Creative URL or id, as written in the sheet. */
  ref: string;
  capturedAt: Date;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  engagements: number | null;
  saves: number | null;
  shares: number | null;
  videoViews: number | null;
  leads: number | null;
  spend: number | null;
};

export type MetricsParse = {
  layout: "platina" | "linkedin" | null;
  rows: ImportedMetricRow[];
  errors: string[];
};

type Field = Exclude<keyof ImportedMetricRow, "ref" | "capturedAt"> | "ref" | "capturedAt" | "reactions" | "comments" | "reposts";

const ALIASES: Record<string, Field> = {
  creative: "ref",
  creative_url: "ref",
  creative_id: "ref",
  url: "ref",
  post_link: "ref",
  update_link: "ref",
  post_url: "ref",
  captured_at: "capturedAt",
  date: "capturedAt",
  created_date: "capturedAt",
  impressions: "impressions",
  reach: "reach",
  unique_impressions: "reach",
  clicks: "clicks",
  engagements: "engagements",
  saves: "saves",
  shares: "shares",
  video_views: "videoViews",
  views: "videoViews",
  leads: "leads",
  spend: "spend",
  reactions: "reactions",
  likes: "reactions",
  comments: "comments",
  reposts: "reposts",
};

/** "Post link" -> "post_link"; strips BOM and quotes. */
export function headerKey(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Splits one CSV line, honouring double quotes ("a, b" stays one cell). */
export function splitCsvLine(line: string, delimiter = ","): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell.trim());
  return out;
}

/** "1,234" / "1 234" / "12.5%" -> number; "" / "-" -> null; anything else -> NaN. */
export function parseCount(raw: string): number | null {
  const v = raw.replace(/^"|"$/g, "").trim();
  if (v === "" || v === "-" || v.toLowerCase() === "n/a") return null;
  const n = Number(v.replace(/[\s,]/g, "").replace(/%$/, ""));
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

/** ISO dates, and LinkedIn's "MM/DD/YYYY". */
export function parseSheetDate(raw: string): Date | null {
  const v = raw.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (us) {
    const d = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseMetricsSheet(text: string, today: Date): MetricsParse {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { layout: null, rows: [], errors: ["Paste a header row and at least one row of numbers."] };
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const header = splitCsvLine(lines[0], delimiter).map(headerKey);
  const fields = header.map((h) => ALIASES[h] ?? null);
  if (!fields.includes("ref")) {
    return {
      layout: null,
      rows: [],
      errors: ['The header needs a column naming the creative: "creative" (URL or id), or LinkedIn\'s "Post link".'],
    };
  }
  const known = fields.filter((f) => f !== null && f !== "ref" && f !== "capturedAt");
  if (known.length === 0) {
    return { layout: null, rows: [], errors: ["No number columns found (impressions, clicks, engagements, reactions, ...)."] };
  }
  const layout = fields.includes("reactions") || header.includes("post_link") || header.includes("update_link") ? "linkedin" : "platina";

  const rows: ImportedMetricRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], delimiter);
    const lineNo = i + 1;
    const values: Partial<Record<Field, number | null>> = {};
    let ref = "";
    let capturedAt: Date | null = null;
    let bad = false;
    fields.forEach((field, col) => {
      if (!field) return;
      const cell = cells[col] ?? "";
      if (field === "ref") ref = cell.replace(/^"|"$/g, "").trim();
      else if (field === "capturedAt") {
        if (cell.trim() === "") return;
        capturedAt = parseSheetDate(cell);
        if (!capturedAt) {
          errors.push(`line ${lineNo}: "${cell}" is not a date (use YYYY-MM-DD)`);
          bad = true;
        }
      } else {
        const n = parseCount(cell);
        if (Number.isNaN(n)) {
          errors.push(`line ${lineNo}: "${cell}" in ${header[col]} is not a number`);
          bad = true;
        } else {
          values[field] = n;
        }
      }
    });
    if (!ref) {
      errors.push(`line ${lineNo}: no creative URL or id`);
      bad = true;
    }
    if (bad) continue;
    const parts = [values.reactions, values.comments, values.reposts].filter((v): v is number => typeof v === "number");
    const engagements = values.engagements ?? (parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null);
    rows.push({
      ref,
      capturedAt: capturedAt ?? today,
      impressions: values.impressions ?? null,
      reach: values.reach ?? null,
      clicks: values.clicks ?? null,
      engagements,
      saves: values.saves ?? null,
      shares: values.shares ?? values.reposts ?? null,
      videoViews: values.videoViews ?? null,
      leads: values.leads ?? null,
      spend: values.spend ?? null,
    });
  }
  return { layout, rows, errors };
}

/** Same URL written two ways ("https://www.x.com/a/" vs "x.com/a") matches. */
export function refKey(ref: string): string {
  return ref
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "");
}
