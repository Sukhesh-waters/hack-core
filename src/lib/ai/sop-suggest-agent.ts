import { z } from "zod";
import type { SopRunRow, SopRunStepRow } from "@/db/queries/sop";
import { routeAI } from "@/lib/ai/router";

export class SopSuggestAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SopSuggestAgentError";
  }
}

const suggestionResponseSchema = z.object({
  action: z.string().trim().min(3),
  reason: z.string().trim().min(3),
  urgency: z.enum(["low", "medium", "high"]),
});

export type StepSuggestion = z.infer<typeof suggestionResponseSchema>;

export function buildSuggestPrompt(input: {
  step: SopRunStepRow;
  allSteps: SopRunStepRow[];
  run: SopRunRow;
  now?: Date;
}): string | null {
  const { step, allSteps, run } = input;
  const now = input.now ?? new Date();

  // If step is closed, return null immediately
  if (step.status === "done" || step.status === "skipped") {
    return null;
  }

  // Find prerequisite steps holding this step up
  const blockers = allSteps.filter(
    (s) =>
      step.dependsOn.includes(s.id) &&
      s.status !== "done" &&
      s.status !== "skipped",
  );

  const isLate = new Date(step.dueAt).getTime() < now.getTime();

  // Min-N / insufficient-context: if healthy and not blocked, no suggestion needed
  if (blockers.length === 0 && !isLate && step.status !== "blocked") {
    return null;
  }

  const blockerSummary =
    blockers.length > 0
      ? blockers
          .map(
            (b) =>
              `- Step "${b.title}" (status: ${b.status}, due: ${new Date(b.dueAt).toLocaleDateString()}, assignee: ${b.assigneeId ?? "unassigned"})`,
          )
          .join("\n")
      : "(None)";

  return [
    `Run context: "${run.name}" (Client: ${run.clientName ?? "Internal"})`,
    `Target Step: "${step.title}"`,
    `- Current status: ${step.status}`,
    `- Gate: ${step.gate}`,
    `- Creates: ${step.creates}`,
    `- Due date: ${new Date(step.dueAt).toLocaleDateString()} (${isLate ? "OVERDUE" : "On schedule"})`,
    `- Assignee: ${step.assigneeId ?? "Unassigned"}`,
    ``,
    `Prerequisites holding this step up:`,
    blockerSummary,
    ``,
    `Formulate concise, grounded advice on what concrete action should be taken to unblock or progress this step.`,
    `Reply strictly in JSON: {"action": string, "reason": string, "urgency": "low" | "medium" | "high"}.`,
  ].join("\n");
}

/**
 * A3 — Next-Action Suggestion for blocked or at-risk steps.
 * Grounded strictly in the run's state.
 * Returns null if step is healthy or has no actionable advice.
 */
export async function suggestNextAction(input: {
  step: SopRunStepRow;
  allSteps: SopRunStepRow[];
  run: SopRunRow;
  now?: Date;
}): Promise<StepSuggestion | null> {
  const prompt = buildSuggestPrompt(input);
  if (!prompt) return null;

  try {
    const raw = await routeAI({
      kind: "chat",
      tier: "fast",
      json: true,
      system:
        "You are an agile operations assistant giving grounded advice to unblock team workflow steps. Base recommendations strictly on the provided step dependencies and owner assignments — never invent external facts.",
      prompt,
    });

    const parsed = suggestionResponseSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (error) {
    throw new SopSuggestAgentError(
      `Could not generate next-action suggestion: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
