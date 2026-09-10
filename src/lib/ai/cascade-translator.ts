import { routeAI } from "@/lib/ai/router";
import type { CascadeResult } from "@/lib/sop/cascade";

/**
 * Explains a schedule cascade in plain, operational English.
 * If AI routing fails, falls back to a deterministic formatted summary.
 */
export async function explainCascade(
  proposal: CascadeResult,
  context: { clientName?: string | null },
): Promise<string> {
  const movesSummary = proposal.moves
    .map(
      (m) =>
        `- "${m.stepTitle}" shifted from ${m.fromDate.toLocaleDateString()} to ${m.toDate.toLocaleDateString()}`,
    )
    .join("\n");

  const breachSummary = proposal.breaches.map((b) => `- ${b.message}`).join("\n");

  const prompt = `You are an agency operations director. Summarize the following schedule cascade concisely for internal team leads:
Client: ${context.clientName ?? "Internal Workspace"}
Slip: ${proposal.slipDays} business days
Shifted Deliverables:
${movesSummary}

Potential Risks/Breaches:
${breachSummary || "None detected."}

Write 2 concise sentences explaining why dates moved and highlighting any critical bottlenecks.`;

  try {
    const res = await routeAI({
      kind: "chat",
      tier: "fast",
      prompt,
    });
    return res.trim();
  } catch {
    // Deterministic fallback
    return `Schedule cascade applied: ${proposal.moves.length} downstream deliverables shifted forward by ${proposal.slipDays} business days due to previous milestone delay.`;
  }
}

/**
 * Drafts an editable client update note explaining the adjusted delivery schedule.
 */
export async function draftClientNote(
  proposal: CascadeResult,
  context: { clientName?: string | null },
): Promise<string> {
  const clientName = context.clientName ?? "Team";
  const prompt = `Draft a polite, professional 3-sentence email update to the client (${clientName}) explaining that deliverable milestones have been adjusted by ${proposal.slipDays} business days to maintain quality. Maintain a reassuring, proactive agency tone.`;

  try {
    const res = await routeAI({
      kind: "chat",
      tier: "fast",
      prompt,
    });
    return res.trim();
  } catch {
    // Deterministic fallback
    return `Hi ${clientName},\n\nWe have updated our production timeline to ensure every deliverable meets our highest quality standards. The revised milestone dates have been reflected on your shared calendar.\n\nBest regards,\nYour Account Team`;
  }
}
