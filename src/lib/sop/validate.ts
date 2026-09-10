import type { SopRunRow, SopRunStepRow } from "@/db/queries/sop";

export type FindingSeverity = "error" | "warning";

export type RunFinding = {
  stepId?: string;
  stepTitle?: string;
  severity: FindingSeverity;
  message: string;
  fix: string;
};

/**
 * Checks if a date falls on a weekend (Saturday or Sunday in local time).
 */
export function isWeekend(date: Date): boolean {
  const day = new Date(date).getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Pure function that validates a SOP run and its steps for operational risks or configuration flaws.
 * Returns structured findings naming the affected step and concrete fix.
 */
export function validateRun(input: {
  run: SopRunRow;
  steps: SopRunStepRow[];
  now?: Date;
}): RunFinding[] {
  const { run, steps } = input;
  const now = input.now ?? new Date();
  const findings: RunFinding[] = [];

  // Check 1: Anchor date in the past at run start
  if (run.status === "active" && new Date(run.anchorDate).getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    findings.push({
      severity: "warning",
      message: `Run anchor date (${new Date(run.anchorDate).toLocaleDateString()}) is in the past.`,
      fix: "Review step due dates to ensure team capacity and reschedule downstream steps if necessary.",
    });
  }

  const stepMap = new Map(steps.map((s) => [s.id, s]));

  for (const step of steps) {
    // Only validate steps that are still active (not done/skipped)
    if (step.status === "done" || step.status === "skipped") {
      continue;
    }

    // Check 2: Unassigned step with no role rule
    if (!step.assigneeId && !step.assigneeRole) {
      findings.push({
        stepId: step.id,
        stepTitle: step.title,
        severity: "warning",
        message: `Step "${step.title}" has no assigned owner or required role.`,
        fix: "Assign a team member or set a role requirement on the step.",
      });
    }

    // Check 3: Due date lands on a weekend
    if (isWeekend(step.dueAt)) {
      const dayName = new Date(step.dueAt).getDay() === 0 ? "Sunday" : "Saturday";
      findings.push({
        stepId: step.id,
        stepTitle: step.title,
        severity: "warning",
        message: `Step "${step.title}" is due on a ${dayName} (${new Date(step.dueAt).toLocaleDateString()}).`,
        fix: "Reschedule the step due date to the nearest weekday.",
      });
    }

    // Check 4: Compliance gate with nothing linked to check
    if (step.gate === "compliance" && (!step.linkedType || !step.linkedId)) {
      findings.push({
        stepId: step.id,
        stepTitle: step.title,
        severity: "error",
        message: `Step "${step.title}" has a compliance gate but no draft linked to check.`,
        fix: "Create a linked content draft from this step so compliance automated checks can run and close the gate.",
      });
    }

    // Check 5: Dependent step is due before its dependency
    for (const depId of step.dependsOn) {
      const dep = stepMap.get(depId);
      if (dep && new Date(step.dueAt).getTime() < new Date(dep.dueAt).getTime()) {
        findings.push({
          stepId: step.id,
          stepTitle: step.title,
          severity: "error",
          message: `Step "${step.title}" (due ${new Date(step.dueAt).toLocaleDateString()}) is due before its prerequisite "${dep.title}" (due ${new Date(dep.dueAt).toLocaleDateString()}).`,
          fix: "Adjust due dates so prerequisite steps complete before dependent steps are due.",
        });
      }
    }
  }

  return findings;
}
