/**
 * Outcome import + lead-quality scoring (Slice 9). Pure.
 *
 * The CSV contract is strict: a bad header or a bad row is an error with a
 * line number, never a silent partial parse. Dedupe is by row content hash
 * against what the workspace already holds. The lead-quality score is a
 * documented heuristic — labelled as such wherever it is shown, and never
 * shown below the workspace minimum-N.
 */
import { createHash } from "node:crypto";

export type OutcomeRow = {
  leads: number;
  qualifiedLeads: number;
  conversionRate?: number;
  pipelineContribution?: number;
  qualityScore?: number;
  campaignId?: string;
  receiptId?: string;
  recordedAt?: Date;
};

export type ParseResult = {
  rows: OutcomeRow[];
  errors: string[];
};

const REQUIRED_HEADER = ["leads", "qualified_leads"];
const KNOWN_HEADER = new Set([
  "leads",
  "qualified_leads",
  "conversion_rate",
  "pipeline_contribution",
  "quality_score",
  "campaign_id",
  "receipt_id",
  "recorded_at",
]);

export function parseOutcomeCsv(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) {
    return { rows: [], errors: ["empty input"] };
  }
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_HEADER.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [`header missing required column(s): ${missing.join(", ")}`],
    };
  }
  const unknown = header.filter((h) => !KNOWN_HEADER.has(h));
  if (unknown.length > 0) {
    return {
      rows: [],
      errors: [`header has unknown column(s): ${unknown.join(", ")}`],
    };
  }

  const rows: OutcomeRow[] = [];
  const errors: string[] = [];
  const col = (name: string) => header.indexOf(name);

  for (const [i, line] of lines.slice(1).entries()) {
    const lineNo = i + 2; // 1-based, header is line 1
    const cells = line.split(",").map((c) => c.trim());
    const leads = Number(cells[col("leads")]);
    const qualified = Number(cells[col("qualified_leads")]);
    if (!Number.isFinite(leads) || leads < 0) {
      errors.push(`line ${lineNo}: leads must be a non-negative number`);
      continue;
    }
    if (!Number.isFinite(qualified) || qualified < 0 || qualified > leads) {
      errors.push(
        `line ${lineNo}: qualified_leads must be a number between 0 and leads`,
      );
      continue;
    }
    const num = (name: string) => {
      const raw = cells[col(name)];
      if (col(name) < 0 || raw === undefined || raw === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const recordedAtRaw = cells[col("recorded_at")];
    const recordedAt =
      col("recorded_at") >= 0 && recordedAtRaw
        ? new Date(recordedAtRaw)
        : undefined;
    if (recordedAt && Number.isNaN(recordedAt.getTime())) {
      errors.push(`line ${lineNo}: recorded_at is not a valid date`);
      continue;
    }
    rows.push({
      leads,
      qualifiedLeads: qualified,
      conversionRate: num("conversion_rate"),
      pipelineContribution: num("pipeline_contribution"),
      qualityScore: num("quality_score"),
      campaignId: cells[col("campaign_id")] || undefined,
      receiptId: cells[col("receipt_id")] || undefined,
      recordedAt,
    });
  }
  return { rows, errors };
}

/** Stable dedupe key over the row's meaningful content. */
export function outcomeRowHash(row: OutcomeRow): string {
  const normalized = [
    row.leads,
    row.qualifiedLeads,
    row.conversionRate ?? "",
    row.pipelineContribution ?? "",
    row.campaignId ?? "",
    row.receiptId ?? "",
    row.recordedAt?.toISOString().slice(0, 10) ?? "",
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Lead-quality heuristic: half the qualified-lead ratio, then conversion
 * rate and pipeline signal (capped at $100k). Documented as a heuristic
 * wherever shown; never shown below the workspace minimum-N.
 */
export function leadQualityScore(row: OutcomeRow): number {
  const qualifiedRatio = row.leads > 0 ? row.qualifiedLeads / row.leads : 0;
  const conversion = Math.min(1, row.conversionRate ?? 0);
  const pipeline = Math.min(1, (row.pipelineContribution ?? 0) / 100_000);
  return (
    Math.round((0.5 * qualifiedRatio + 0.3 * conversion + 0.2 * pipeline) * 1000) /
    1000
  );
}
