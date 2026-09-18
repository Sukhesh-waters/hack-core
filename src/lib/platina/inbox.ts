/**
 * Cockpit priority inbox (Slice 11). Pure composition over real rows:
 * findings awaiting a decision, overdue/due receipts, draft audit scopes,
 * and draft solutions blocked on final approval — ordered by severity, then
 * overdue, then freshness. Every item deep-links to its action surface.
 * Nothing here is a fabricated score.
 */

export type InboxItem = {
  key: string;
  title: string;
  kind: "finding" | "receipt" | "audit_scope" | "solution";
  severityRank: number;
  overdue: boolean;
  at: Date | string | null;
  href: string;
  action: string;
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function rank(severity: string | null | undefined): number {
  return SEVERITY_RANK[severity ?? "medium"] ?? 2;
}

function time(value: Date | string | null): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function buildInbox(
  input: {
    findings: {
      id: string;
      title: string;
      severity: string;
      createdAt: Date | string;
    }[];
    receipts: {
      id: string;
      title: string;
      reviewAt: Date | string;
    }[];
    draftSpecs: { id: string; name: string; createdAt: Date | string }[];
    draftCampaigns: { id: string; title: string; createdAt: Date | string }[];
  },
  base: string,
  now = new Date(),
  cap = 10,
): InboxItem[] {
  const items: InboxItem[] = [];

  for (const f of input.findings) {
    items.push({
      key: `finding-${f.id}`,
      title: f.title,
      kind: "finding",
      severityRank: rank(f.severity),
      overdue: false,
      at: f.createdAt,
      href: `${base}/findings?status=needs_decision`,
      action: "Review finding",
    });
  }
  for (const r of input.receipts) {
    items.push({
      key: `receipt-${r.id}`,
      title: r.title,
      kind: "receipt",
      severityRank: 2,
      overdue: time(r.reviewAt) < now.getTime(),
      at: r.reviewAt,
      href: `${base}/outcomes`,
      action: "Grade outcome",
    });
  }
  for (const s of input.draftSpecs) {
    items.push({
      key: `spec-${s.id}`,
      title: s.name,
      kind: "audit_scope",
      severityRank: 3,
      overdue: false,
      at: s.createdAt,
      href: `${base}/audits`,
      action: "Approve scope",
    });
  }
  for (const c of input.draftCampaigns) {
    items.push({
      key: `campaign-${c.id}`,
      title: c.title,
      kind: "solution",
      severityRank: 2,
      overdue: false,
      at: c.createdAt,
      href: `${base}/solutions/${c.id}`,
      action: "Review solution",
    });
  }

  return items
    .sort((a, b) => {
      if (a.severityRank !== b.severityRank) {
        return a.severityRank - b.severityRank;
      }
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return time(b.at) - time(a.at);
    })
    .slice(0, cap);
}
