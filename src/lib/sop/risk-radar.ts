import { runRisk, daysLate, isClosed, type RiskStep } from "./risk";

export type SopRiskLevel = "on_track" | "at_risk" | "critical";

export type SopRiskRadarAssessment = {
  riskLevel: SopRiskLevel;
  riskScore: number; // 0 (perfect) to 100 (critical delay)
  overdueStepIds: string[];
  atRiskStepIds: string[];
  bottleneckStepId: string | null;
  summary: string;
};

export type SopStalenessAssessment = {
  isStale: boolean;
  reason?: string;
  daysInactive?: number;
};

/**
 * Evaluates the deterministic risk status of an active SOP run based on
 * DAG dependencies and overdue step bottlenecks.
 */
export function evaluateSopRiskRadar(
  steps: RiskStep[],
  now: Date = new Date(),
): SopRiskRadarAssessment {
  if (steps.length === 0) {
    return {
      riskLevel: "on_track",
      riskScore: 0,
      overdueStepIds: [],
      atRiskStepIds: [],
      bottleneckStepId: null,
      summary: "Empty run",
    };
  }

  const { overdue, atRisk } = runRisk(steps, now);

  const totalSteps = steps.length;
  const closedSteps = steps.filter((s) => isClosed(s.status)).length;

  if (closedSteps === totalSteps) {
    return {
      riskLevel: "on_track",
      riskScore: 0,
      overdueStepIds: [],
      atRiskStepIds: [],
      bottleneckStepId: null,
      summary: "All steps completed",
    };
  }

  // Find worst bottleneck step among overdue steps
  let bottleneckStepId: string | null = null;
  let maxLateness = 0;

  for (const id of overdue) {
    const step = steps.find((s) => s.id === id);
    if (step) {
      const late = daysLate(step.dueAt, now);
      if (late > maxLateness) {
        maxLateness = late;
        bottleneckStepId = id;
      }
    }
  }

  let riskLevel: SopRiskLevel = "on_track";
  let riskScore = 0;

  if (overdue.length > 0) {
    riskLevel = maxLateness >= 3 || overdue.length >= 2 ? "critical" : "at_risk";
    riskScore = Math.min(100, 50 + maxLateness * 15 + overdue.length * 10);
  } else if (atRisk.length > 0) {
    riskLevel = "at_risk";
    riskScore = Math.min(75, 25 + atRisk.length * 15);
  }

  const summary =
    riskLevel === "critical"
      ? `Critical: ${overdue.length} overdue step(s) delaying run`
      : riskLevel === "at_risk"
        ? `Warning: ${atRisk.length} downstream step(s) at risk`
        : "On track: No deadline bottlenecks";

  return {
    riskLevel,
    riskScore,
    overdueStepIds: overdue,
    atRiskStepIds: atRisk,
    bottleneckStepId,
    summary,
  };
}

/**
 * Checks if an SOP template is stale (UC-OPS-33) due to prolonged inactivity
 * or missing active runs in the past 90 days.
 */
export function evaluateSopStaleness(input: {
  templateId: string;
  stepCount: number;
  lastRunAt: Date | null;
  now?: Date;
  maxInactiveDays?: number;
}): SopStalenessAssessment {
  const { stepCount, lastRunAt, now = new Date(), maxInactiveDays = 90 } = input;

  if (stepCount === 0) {
    return {
      isStale: true,
      reason: "Template contains zero defined steps",
      daysInactive: undefined,
    };
  }

  if (!lastRunAt) {
    return {
      isStale: true,
      reason: "Template has never been instantiated in a run",
      daysInactive: undefined,
    };
  }

  const diffMs = now.getTime() - lastRunAt.getTime();
  const daysInactive = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (daysInactive > maxInactiveDays) {
    return {
      isStale: true,
      reason: `No active runs in ${daysInactive} days (threshold: ${maxInactiveDays}d)`,
      daysInactive,
    };
  }

  return {
    isStale: false,
    daysInactive,
  };
}
