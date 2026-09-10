import { z } from "zod";
import { routeAI } from "@/lib/ai/router";
import { wouldCreateCycle } from "@/lib/sop/dependencies";
import {
  MAX_OFFSET_DAYS,
  SOP_STEP_CREATES,
  SOP_STEP_GATES,
} from "@/lib/sop/template";

export class SopTemplateAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SopTemplateAgentError";
  }
}

const generatedStepSchema = z.object({
  tempId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  dueOffsetDays: z
    .number()
    .int()
    .min(-MAX_OFFSET_DAYS)
    .max(MAX_OFFSET_DAYS),
  gate: z.enum(SOP_STEP_GATES),
  creates: z.enum(SOP_STEP_CREATES),
  assigneeRole: z.enum(["owner", "admin", "member"]).nullable().optional(),
  dependsOnTempIds: z.array(z.string()).default([]),
});

const generatedTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  anchorLabel: z.string().trim().min(1).max(40),
  steps: z.array(generatedStepSchema).min(1).max(30),
});

export type GeneratedSopTemplate = z.infer<typeof generatedTemplateSchema>;

export function buildTemplateAgentPrompt(description: string): string {
  return [
    `Create a structured Standard Operating Procedure (SOP) process template based on this description:`,
    `"${description}"`,
    ``,
    `Requirements:`,
    `- Provide a template name, description, and anchor label (e.g. "Launch date", "Client kickoff", "Publication day").`,
    `- Provide 3 to 10 sequential or parallel steps.`,
    `- Offset days relative to anchor date: negative for prep steps (e.g. -7 for 7 days before anchor), 0 for anchor day, positive for post-anchor steps (e.g. 3 for 3 days after).`,
    `- Gate options: "none", "approval", "compliance". Use "approval" for signoffs and "compliance" for checks.`,
    `- Creates options: "none", "task", "content", "ticket", "doc".`,
    `- AssigneeRole options: "owner", "admin", "member", or null if unassigned.`,
    `- Dependencies: list previous step tempIds that this step depends on. Must be acyclic!`,
    ``,
    `Reply strictly with JSON only in this format:`,
    `{`,
    `  "name": "Process Name",`,
    `  "description": "Short overview",`,
    `  "anchorLabel": "Target Date Label",`,
    `  "steps": [`,
    `    {`,
    `      "tempId": "step-1",`,
    `      "title": "Initial Step Title",`,
    `      "description": "Step detail",`,
    `      "dueOffsetDays": -5,`,
    `      "gate": "none",`,
    `      "creates": "content",`,
    `      "assigneeRole": "member",`,
    `      "dependsOnTempIds": []`,
    `    }`,
    `  ]`,
    `}`,
  ].join("\n");
}

/**
 * Validates the acyclic graph structure of generated steps.
 */
export function validateGeneratedGraph(
  steps: z.infer<typeof generatedStepSchema>[],
): boolean {
  const nodes = steps.map((s) => ({
    id: s.tempId,
    dependsOn: s.dependsOnTempIds,
  }));

  for (const step of steps) {
    if (wouldCreateCycle(nodes, step.tempId, step.dependsOnTempIds)) {
      return false;
    }
  }
  return true;
}

/**
 * A1 — Draft a SOP template from prose.
 * Calls routeAI with quality tier, parses and validates JSON output, retrying ONCE on failure.
 * Never auto-saves — returns reviewable proposal structure for the client.
 */
export async function generateTemplateDraft(input: {
  description: string;
  workspaceId: string;
}): Promise<GeneratedSopTemplate> {
  const prompt = buildTemplateAgentPrompt(input.description);
  const system =
    "You are an expert operations architect who designs structured, actionable standard operating procedures (SOPs) for marketing, agency, and creative teams.";

  let lastError: string = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await routeAI({
        kind: "chat",
        tier: "quality",
        json: true,
        system,
        prompt:
          attempt === 1
            ? prompt
            : `${prompt}\n\nIMPORTANT: Your previous output failed validation (${lastError}). Ensure valid JSON with valid enum choices and acyclic dependencies.`,
      });

      const parsed = generatedTemplateSchema.parse(JSON.parse(raw));

      if (!validateGeneratedGraph(parsed.steps)) {
        throw new Error("Generated template step dependencies contain a cycle.");
      }

      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Invalid JSON response";
      if (attempt === 2) {
        throw new SopTemplateAgentError(
          `Could not generate a valid template from description: ${lastError}`,
        );
      }
    }
  }

  throw new SopTemplateAgentError("Failed to generate template draft.");
}
