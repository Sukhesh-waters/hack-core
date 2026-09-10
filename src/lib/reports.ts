/** Pure report composition — no I/O, no AI call. Deterministic templating
 *  is sufficient and cheaper/safer than an LLM for a data summary. */

export function nextMonthRange(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  return { start, end };
}

export type ReportInput = {
  clientName: string;
  posts: number;
  scored: number;
  avgEngagement: number | null;
  /** Min-N gate: when true the client is below the baseline sample size, so
   *  no engagement number leaves the app in an outbound report — same rule
   *  the Reports screen renders. */
  insufficient: boolean;
  formats: Array<{
    format: string | null;
    count: number;
    avgEngagement: number | null;
  }>;
  nextMonthScheduled: number;
  monthLabel: string;
};

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function buildReportDraft(input: ReportInput): string {
  const lines = [
    `Performance report — ${input.clientName}`,
    "",
    `Posts tracked: ${input.posts} (${input.scored} scored)`,
  ];

  if (input.insufficient) {
    // Below the baseline sample size — emit the honest notice, never a number.
    lines.push(
      "Average engagement: insufficient baseline — engagement scores appear once this client reaches the baseline sample size.",
    );
  } else {
    lines.push(`Average engagement: ${pct(input.avgEngagement)}`, "", "By format:");
    if (input.formats.length === 0) {
      lines.push("- No first-party posts yet.");
    } else {
      for (const f of input.formats) {
        lines.push(
          `- ${f.format ?? "Unlabeled"}: ${f.count} posts, ${pct(f.avgEngagement)} avg engagement`,
        );
      }
    }
  }

  lines.push(
    "",
    `${input.monthLabel} preview: ${input.nextMonthScheduled} post${input.nextMonthScheduled === 1 ? "" : "s"} already scheduled.`,
  );
  return lines.join("\n");
}

export function buildReportEmail(input: {
  clientName: string;
  body: string;
}): { subject: string; html: string } {
  return {
    subject: `Performance report — ${input.clientName}`,
    html: `<pre style="font-family:ui-monospace,monospace;white-space:pre-wrap">${input.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre>`,
  };
}

export type ReportExportData = {
  clientName: string;
  clientHandle?: string | null;
  generatedAt?: Date;
  posts: number;
  scored: number;
  avgEngagement: number | null;
  insufficient: boolean;
  formats: Array<{
    format: string | null;
    count: number;
    avgEngagement: number | null;
  }>;
  topDrivers?: Array<{
    caption: string | null;
    format?: string | null;
    magnitude: number | null;
  }>;
  underperformers?: Array<{
    caption: string | null;
    format?: string | null;
    magnitude: number | null;
  }>;
  nextMonthScheduled: number;
  monthLabel: string;
};

export function buildReportCsv(input: ReportExportData): string {
  const rows: string[][] = [];

  const escapeCell = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (
      str.includes(",") ||
      str.includes('"') ||
      str.includes("\n") ||
      str.includes("\r")
    ) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const addRow = (...cells: (string | number | null | undefined)[]) => {
    rows.push(cells.map(escapeCell));
  };

  // Section 1: Overview
  addRow("Performance Report", input.clientName);
  if (input.clientHandle) {
    addRow("Handle", input.clientHandle);
  }
  const dateStr = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  addRow("Generated At", dateStr);
  addRow("Posts Tracked", input.posts);
  addRow("Scored Posts", input.scored);
  if (input.insufficient) {
    addRow("Average Engagement", "Insufficient baseline");
    addRow("Baseline Status", "Below baseline (< 10 first-party posts)");
  } else {
    addRow("Average Engagement", pct(input.avgEngagement));
    addRow("Baseline Status", "Cleared");
  }
  addRow(
    `${input.monthLabel} Scheduled Preview`,
    `${input.nextMonthScheduled} post${input.nextMonthScheduled === 1 ? "" : "s"}`,
  );
  addRow(); // Blank separator

  // Section 2: Format Breakdown
  addRow("Format Breakdown");
  addRow("Format", "Posts", "Average Engagement");
  if (input.insufficient) {
    addRow("All formats", input.posts, "Insufficient baseline");
  } else if (input.formats.length === 0) {
    addRow("No first-party posts", 0, "—");
  } else {
    for (const f of input.formats) {
      addRow(f.format ?? "Unlabeled", f.count, pct(f.avgEngagement));
    }
  }
  addRow(); // Blank separator

  // Section 3: Top Performance Drivers
  addRow("Top Performance Drivers (Above Baseline)");
  addRow("Caption", "Format", "Magnitude");
  if (input.insufficient) {
    addRow("Insufficient baseline", "—", "—");
  } else if (!input.topDrivers || input.topDrivers.length === 0) {
    addRow("None recorded", "—", "—");
  } else {
    for (const d of input.topDrivers) {
      const mag =
        d.magnitude !== null && d.magnitude !== undefined
          ? `+${Math.round(d.magnitude * 100)}%`
          : "—";
      addRow(d.caption ?? "Untitled post", d.format ?? "Unlabeled", mag);
    }
  }
  addRow(); // Blank separator

  // Section 4: Underperformers
  addRow("Underperformers (Below Baseline)");
  addRow("Caption", "Format", "Magnitude");
  if (input.insufficient) {
    addRow("Insufficient baseline", "—", "—");
  } else if (!input.underperformers || input.underperformers.length === 0) {
    addRow("None recorded", "—", "—");
  } else {
    for (const u of input.underperformers) {
      const mag =
        u.magnitude !== null && u.magnitude !== undefined
          ? `-${Math.round(u.magnitude * 100)}%`
          : "—";
      addRow(u.caption ?? "Untitled post", u.format ?? "Unlabeled", mag);
    }
  }

  return rows.map((r) => r.join(",")).join("\r\n");
}

