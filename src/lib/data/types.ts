/**
 * Section data contracts. Each screen renders exactly these shapes,
 * whether the provider is demo (Phase A) or live (Phase B+).
 */

// ---- Team Hub ----
export type HubMember = {
  id: string;
  name: string;
  initial: string;
  online: boolean;
};

export type HubMessage =
  | { id: string; kind: "system"; time: string; text: string }
  | {
      id: string;
      kind: "text";
      time: string;
      author: string;
      initial: string;
      text: string;
    }
  | {
      id: string;
      kind: "approval";
      approvalId: string;
      time: string;
      author: string;
      initial: string;
      title: string;
      status: "pending" | "approved" | "rejected";
      decidedBy?: string;
    };

export type HubApproval = {
  id: string;
  title: string;
  requestedBy: string;
  time: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
};

export type HubPriority = "High" | "Medium" | "Low";

export type HubTask = {
  id: string;
  title: string;
  done: boolean;
  priority: HubPriority;
  originRunStepId?: string | null;
  sopOrigin?: {
    runId: string;
    stepId: string;
    stepTitle: string;
  } | null;
};

export type HubReminder = {
  id: string;
  title: string;
  due: string; // human label in demo mode, ISO once live
  owner: string;
  overdue: boolean;
  sentLabel: string | null;
};

export type HubPlanItem = {
  id: string;
  title: string;
  format: string;
  status: "proposed" | "accepted" | "rejected";
};

export type TeamHubData = {
  channel: string;
  members: HubMember[];
  messages: HubMessage[];
  approvals: HubApproval[];
  tasks: HubTask[];
  completedTasks?: HubTask[];
  reminders: HubReminder[];
  planQuickView: HubPlanItem[];
};

// ---- Overview ----
export type OverviewStat = { label: string; value: string; sub: string };

export type OverviewBoardRow = { id: string; title: string; stage: string };

export type OverviewSlot = {
  id: string;
  title: string;
  platform: string;
  day: number;
  status: string;
};

// ---- Overview / V3 Marketing OS composition ----
// Read-only signals composed from already-existing feature queries (Cockpit
// spend, Brand Drift, Tickets, Automations) — see src/lib/data/live/overview.ts
// and counterattack-09-fragmentation.md's "V3" slice. Nothing here is a new
// data pipeline; each field is a summary of an existing table's data.

export type OverviewSpend = {
  todayUsd: number;
  capUsd: number;
  percentUsed: number;
  overCap: boolean;
};

/** Per-client drift is min-N gated (DRIFT_MIN_N) — a client below the floor
 *  never contributes a magnitude, only counts toward `insufficientCount`. */
export type OverviewDriftSummary = {
  worstNarrative: "steady" | "drifting" | "needs attention" | null;
  worstClientName: string | null;
  scoredCount: number;
  insufficientCount: number;
};

export type OverviewTicketsSummary = {
  openCount: number;
  overdueCount: number;
};

export type OverviewAutomationFailure = {
  id: string;
  ruleName: string;
  error: string | null;
  occurredAt: Date;
};

export type OverviewAutomationsSummary = {
  failureCount: number;
  mostRecent: OverviewAutomationFailure | null;
};

export type OverviewData = {
  stats: OverviewStat[];
  productionBoard: OverviewBoardRow[];
  upcoming: OverviewSlot[];
  spend: OverviewSpend;
  drift: OverviewDriftSummary;
  tickets: OverviewTicketsSummary;
  automations: OverviewAutomationsSummary;
};
