/**
 * Pure metrics and cycle time calculations for executable SOP templates.
 * Enforces the Min-N gate constitution: no average durations or cycle times
 * are reported as confident statistics until the minimum sample threshold is met.
 */

export type TemplateRunSummary = {
  runId: string;
  runName: string;
  clientId: string | null;
  clientName: string | null;
  startedById: string;
  startedByName: string | null;
  status: "active" | "completed" | "cancelled";
  createdAt: Date;
  completedAt: Date | null;
  anchorDate: Date;
  durationHours: number | null;
  durationDays: number | null;
  isOnTime: boolean | null;
  totalSteps: number;
  completedSteps: number;
};

export type StepBottleneckMetric = {
  templateStepId: string | null;
  stepTitle: string;
  sampleCount: number;
  avgDurationHours: number | null;
  avgDurationDays: number | null;
  rejectionCount: number;
};

export type TemplateMetricsRollup = {
  templateId: string;
  totalRuns: number;
  completedRunsCount: number;
  activeRunsCount: number;
  cancelledRunsCount: number;
  avgDurationHours: number | null;
  avgDurationDays: number | null;
  onTimeRate: number | null;
  hasEnoughData: boolean;
  minSampleRequired: number;
  bottlenecks: StepBottleneckMetric[];
  slowestStep: StepBottleneckMetric | null;
  runs: TemplateRunSummary[];
};

export const MIN_SOP_SAMPLE_N = 3;

export function calculateTemplateMetrics(
  templateId: string,
  runs: Array<{
    id: string;
    name: string;
    clientId: string | null;
    clientName: string | null;
    startedById: string;
    startedByName: string | null;
    status: "active" | "completed" | "cancelled";
    createdAt: Date;
    completedAt: Date | null;
    anchorDate: Date;
    steps?: Array<{
      id: string;
      templateStepId: string | null;
      title: string;
      status: string;
      dueAt: Date;
      completedAt: Date | null;
      rejectionReason: string | null;
      createdAt?: Date | null;
    }>;
  }>,
  minSampleN: number = MIN_SOP_SAMPLE_N,
): TemplateMetricsRollup {
  if (runs.length === 0) {
    return {
      templateId,
      totalRuns: 0,
      completedRunsCount: 0,
      activeRunsCount: 0,
      cancelledRunsCount: 0,
      avgDurationHours: null,
      avgDurationDays: null,
      onTimeRate: null,
      hasEnoughData: false,
      minSampleRequired: minSampleN,
      bottlenecks: [],
      slowestStep: null,
      runs: [],
    };
  }

  const summarizedRuns: TemplateRunSummary[] = runs.map((r) => {
    const steps = r.steps ?? [];
    const completedSteps = steps.filter((s) => s.status === "done").length;

    let durationHours: number | null = null;
    let durationDays: number | null = null;
    let isOnTime: boolean | null = null;

    if (r.status === "completed" && r.completedAt) {
      const diffMs = Math.max(0, r.completedAt.getTime() - r.createdAt.getTime());
      durationHours = Number((diffMs / (1000 * 60 * 60)).toFixed(1));
      durationDays = Number((diffMs / (1000 * 60 * 60 * 24)).toFixed(1));

      // Consider on-time if finished on or before the anchor date + 24h grace period
      const anchorDeadline = new Date(r.anchorDate.getTime() + 24 * 60 * 60 * 1000);
      isOnTime = r.completedAt.getTime() <= anchorDeadline.getTime();
    }

    return {
      runId: r.id,
      runName: r.name,
      clientId: r.clientId,
      clientName: r.clientName,
      startedById: r.startedById,
      startedByName: r.startedByName,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      anchorDate: r.anchorDate,
      durationHours,
      durationDays,
      isOnTime,
      totalSteps: steps.length,
      completedSteps,
    };
  });

  const completed = summarizedRuns.filter(
    (r) => r.status === "completed" && r.durationHours !== null,
  );
  const activeCount = summarizedRuns.filter((r) => r.status === "active").length;
  const cancelledCount = summarizedRuns.filter((r) => r.status === "cancelled").length;

  const hasEnoughData = completed.length >= minSampleN;

  let avgDurationHours: number | null = null;
  let avgDurationDays: number | null = null;
  let onTimeRate: number | null = null;

  if (hasEnoughData) {
    const totalHours = completed.reduce((sum, r) => sum + (r.durationHours ?? 0), 0);
    const totalDays = completed.reduce((sum, r) => sum + (r.durationDays ?? 0), 0);
    const onTimeCount = completed.filter((r) => r.isOnTime === true).length;

    avgDurationHours = Number((totalHours / completed.length).toFixed(1));
    avgDurationDays = Number((totalDays / completed.length).toFixed(1));
    onTimeRate = Number(((onTimeCount / completed.length) * 100).toFixed(1));
  }

  // Step bottleneck analysis across all runs
  type StepAccumulator = {
    templateStepId: string | null;
    stepTitle: string;
    durationsHours: number[];
    rejections: number;
  };
  const stepMap = new Map<string, StepAccumulator>();

  for (const r of runs) {
    const steps = r.steps ?? [];
    for (const s of steps) {
      const key = s.templateStepId ?? s.title;
      let acc = stepMap.get(key);
      if (!acc) {
        acc = {
          templateStepId: s.templateStepId,
          stepTitle: s.title,
          durationsHours: [],
          rejections: 0,
        };
        stepMap.set(key, acc);
      }

      if (s.rejectionReason) {
        acc.rejections += 1;
      }

      if (s.status === "done" && s.completedAt) {
        const stepStart = s.createdAt ?? r.createdAt;
        const diffMs = Math.max(0, s.completedAt.getTime() - stepStart.getTime());
        acc.durationsHours.push(diffMs / (1000 * 60 * 60));
      }
    }
  }

  const bottlenecks: StepBottleneckMetric[] = Array.from(stepMap.values()).map(
    (acc) => {
      const sampleCount = acc.durationsHours.length;
      const avgH =
        sampleCount > 0
          ? Number(
              (
                acc.durationsHours.reduce((a, b) => a + b, 0) / sampleCount
              ).toFixed(1),
            )
          : null;
      const avgD = avgH !== null ? Number((avgH / 24).toFixed(1)) : null;

      return {
        templateStepId: acc.templateStepId,
        stepTitle: acc.stepTitle,
        sampleCount,
        avgDurationHours: avgH,
        avgDurationDays: avgD,
        rejectionCount: acc.rejections,
      };
    },
  );

  // Sort by average duration descending
  bottlenecks.sort((a, b) => (b.avgDurationHours ?? 0) - (a.avgDurationHours ?? 0));

  const slowestStep =
    bottlenecks.find((b) => b.sampleCount > 0 && b.avgDurationHours !== null) ?? null;

  return {
    templateId,
    totalRuns: runs.length,
    completedRunsCount: completed.length,
    activeRunsCount: activeCount,
    cancelledRunsCount: cancelledCount,
    avgDurationHours,
    avgDurationDays,
    onTimeRate,
    hasEnoughData,
    minSampleRequired: minSampleN,
    bottlenecks,
    slowestStep,
    runs: summarizedRuns,
  };
}
