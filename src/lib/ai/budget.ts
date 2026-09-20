import { isDbConfigured } from "@/db";
import { listImmediateMemberEmails } from "@/db/queries/memberships";
import {
  getWorkspaceSpendSince,
  hasCapAlertSince,
  insertAiUsage,
} from "@/db/queries/usage";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { currentAiCost } from "@/lib/ai/usage-context";
import { resend } from "@/lib/resend";

export class AIBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIBudgetError";
  }
}

export function aiDailyCapUsd(): number {
  const raw = Number(process.env.AI_DAILY_COST_CAP_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

/** UTC day start — the cap window. */
export function dayStart(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Called by routeAI before every provider call. Outside a cost context (or
 * without a configured DB) it is a no-op — system jobs and tests are never
 * budget-gated. On first breach of the day: one alert email + a zero-cost
 * cap-alert marker row, then every further call throws until the window
 * resets (degradation: clear error, app keeps working).
 */
export async function enforceAiBudget(now: Date = new Date()): Promise<void> {
  const ctx = currentAiCost();
  if (!ctx || !isDbConfigured()) return;

  const since = dayStart(now);
  const cap = aiDailyCapUsd();
  const { costUsd } = await getWorkspaceSpendSince(ctx.workspaceId, since);
  if (costUsd < cap) return;

  try {
    if (!(await hasCapAlertSince(ctx.workspaceId, since))) {
      await insertAiUsage({
        workspaceId: ctx.workspaceId,
        provider: "system",
        model: "cap",
        kind: "alert",
        purpose: "cap-alert",
      });
      // Honours the digest preference too — "off" has to mean off, or
      // it is a setting that lies.
      const to = await listImmediateMemberEmails(ctx.workspaceId);
      if (to.length > 0) {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || "onboarding@resend.dev",
          to,
          subject: "InstaMedia AI — daily AI budget reached",
          html: `<p>This workspace hit its daily AI spend cap of $${cap.toFixed(2)}. AI actions are paused until the day resets (UTC). Raise AI_DAILY_COST_CAP_USD if this cap is too tight.</p>`,
        });
      }
    }
  } catch (error) {
    console.error("AI budget alert failed:", error);
  }

  throw new AIBudgetError(
    `Daily AI budget reached ($${cap.toFixed(2)}). AI actions resume when the day resets (UTC), or raise AI_DAILY_COST_CAP_USD.`,
  );
}

export type UsageEvent = {
  provider: string;
  model: string;
  kind: "chat" | "embed";
  tier?: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs?: number;
  /** Defaults to "ok". A failed attempt is logged with zero tokens and cost. */
  status?: "ok" | "failed";
  error?: string;
};

/** Fire-and-forget: a telemetry failure must never fail the AI call. */
export function logAiUsage(event: UsageEvent): void {
  if (!isDbConfigured()) return;
  const ctx = currentAiCost();
  const failed = event.status === "failed";
  void insertAiUsage({
    workspaceId: ctx?.workspaceId ?? null,
    provider: event.provider,
    model: event.model,
    kind: event.kind,
    tier: event.tier ?? null,
    tokensIn: failed ? 0 : event.tokensIn,
    tokensOut: failed ? 0 : event.tokensOut,
    costUsd: failed
      ? 0
      : estimateCostUsd(event.model, event.tokensIn, event.tokensOut),
    purpose: ctx?.purpose ?? null,
    latencyMs: event.latencyMs ?? null,
    status: failed ? "failed" : "ok",
    error: failed ? (event.error ?? "unknown error") : null,
  }).catch((error) => console.error("AI usage log failed:", error));
}
