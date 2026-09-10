import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  brandProfiles,
  type BrandContext,
  type BrandIdentity,
} from "@/db/schema";

export async function getBrandProfile(workspaceId: string, clientId: string) {
  const rows = await db
    .select()
    .from(brandProfiles)
    .where(
      and(
        eq(brandProfiles.workspaceId, workspaceId),
        eq(brandProfiles.clientId, clientId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Insert-or-update against the one-profile-per-client unique index. */
export async function saveBrandProfile(
  workspaceId: string,
  clientId: string,
  patch: {
    identity?: BrandIdentity | null;
    declared?: BrandContext | null;
    status: "declared" | "researching" | "ready" | "failed";
    error?: string | null;
    model?: string | null;
  },
) {
  await db
    .insert(brandProfiles)
    .values({ workspaceId, clientId, ...patch })
    .onConflictDoUpdate({
      target: [brandProfiles.workspaceId, brandProfiles.clientId],
      set: { ...patch, updatedAt: new Date() },
    });
}
