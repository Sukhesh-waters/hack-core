"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { brandProfiles } from "@/db/schema";
import { getBrandProfile, saveBrandProfile } from "@/db/queries/brand";
import { getClientById } from "@/db/queries/clients";
import { requireMembership } from "@/db/queries/memberships";
import { getKbStats, topMoversQuery } from "@/db/queries/posts";
import { actionErrorMessage } from "@/lib/action-errors";
import { researchBrand } from "@/lib/ai/agents/content";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { bedrockConfigured } from "@/lib/flags";
import { brandContextSchema } from "@/lib/validation";

export type BrandActionState = { error?: string } | undefined;

export async function runBrandResearch(
  _prev: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const force = formData.get("force") === "true";

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };

    // Cached, runs once (constitution): skip when a profile is ready
    const existing = await getBrandProfile(workspaceId, clientId);
    if (existing?.status === "ready" && !force) return undefined;

    await saveBrandProfile(workspaceId, clientId, { status: "researching" });
    try {
      const [stats, movers] = await Promise.all([
        getKbStats(workspaceId),
        topMoversQuery(workspaceId, clientId, "up", 10),
      ]);
      // Declared context rides along as authoritative input — research
      // enriches it and NEVER overwrites the declared jsonb itself.
      const identity = await runWithAiCost(
        { workspaceId, purpose: "brand-research" },
        () =>
          researchBrand({
            name: client.name,
            handle: client.handle,
            kbStats: stats,
            topCaptions: movers
              .map((m) => m.caption)
              .filter((c): c is string => Boolean(c)),
            declared: existing?.declared ?? null,
          }),
      );
      await saveBrandProfile(workspaceId, clientId, {
        identity,
        status: "ready",
        error: null,
        model: bedrockConfigured() ? "bedrock" : "gemini/groq",
      });
    } catch (error) {
      await saveBrandProfile(workspaceId, clientId, {
        status: "failed",
        error: actionErrorMessage(error),
      });
      return { error: actionErrorMessage(error) };
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/brand-gene`);
  return undefined;
}

export type VaultActionState =
  | { error?: string; savedAt?: number }
  | undefined;

const vaultSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  context: brandContextSchema,
});

/**
 * Vault edit: replaces `declared` only. Never touches `identity` or status —
 * a human's rules survive every research run, and vice versa. Stamps
 * declared_updated_at (not updated_at) so staleness vs enrichment is honest.
 */
export async function updateBrandContext(
  _prev: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Malformed vault payload — reload and try again." };
  }
  const parsed = vaultSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId, context } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found." };
    const profile = await getBrandProfile(workspaceId, clientId);
    if (!profile) {
      return { error: "No brand profile — complete intake first." };
    }
    await db
      .update(brandProfiles)
      .set({ declared: context, declaredUpdatedAt: new Date() })
      .where(
        and(
          eq(brandProfiles.workspaceId, workspaceId),
          eq(brandProfiles.clientId, clientId),
        ),
      );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/brand-gene`);
  return { savedAt: Date.now() };
}
