"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  getBrand,
  insertBrandChunk,
  supersedeBrandChunksForBrand,
} from "@/db/queries/platina";
import { inngest } from "@/inngest/client";
import { profileToStandard } from "@/lib/platina/brand-standard";
import { embedText } from "@/lib/platina/embed";

/** Rebuilds the client profile from the pages already collected. */
export async function refreshProfileAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const here = `/p/${ws}/brands/${brandId}`;

  const user = await requireUser();
  await requireMembership(ws, user.id);
  const brand = await getBrand(ws, brandId);
  if (!brand || brand.kind !== "own_brand") redirect(`/p/${ws}/brands`);

  try {
    await inngest.send({
      name: "platina/client.profile.requested",
      data: { workspaceId: ws, brandId },
    });
  } catch {
    redirect(
      `${here}?error=${encodeURIComponent(
        "The background job runner is not running. Start it with npm run dev:all, then try again.",
      )}`,
    );
  }
  revalidatePath(here);
  redirect(`${here}?analysing=1`);
}

/**
 * Confirms the derived profile as this client's declared brand standard
 * (core spine R3, owner decision O3).
 *
 * Until an operator does this, the profile is context only. Confirming it
 * writes Plane A brand chunks tagged to this client, which is what the
 * brand_divergence stage compares competitor evidence against — the step that
 * was missing for every client onboarded through /start.
 *
 * A re-confirmation supersedes the previous standard rather than stacking a
 * second copy beside it.
 */
export async function confirmBrandStandardAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const here = `/p/${ws}/brands/${brandId}`;

  const user = await requireUser();
  await requireMembership(ws, user.id);
  const brand = await getBrand(ws, brandId);
  if (!brand || brand.kind !== "own_brand") redirect(`/p/${ws}/brands`);

  const chunks = profileToStandard(brand.name, brand.profile);
  if (chunks.length === 0) {
    redirect(
      `${here}?error=${encodeURIComponent(
        "There is nothing to confirm yet — the profile is still empty.",
      )}`,
    );
  }

  await supersedeBrandChunksForBrand(ws, brandId);
  for (const [index, chunk] of chunks.entries()) {
    // Embedded so the standard is retrievable; a router outage stores the
    // text without a vector rather than losing the confirmation.
    const embedding = await embedText(chunk.content);
    await insertBrandChunk({
      workspaceId: ws,
      brandId,
      title: chunk.title,
      content: chunk.content,
      chunkIndex: index,
      sourceUrl: brand.homepageUrl ?? undefined,
      ...(embedding ? { embedding } : {}),
    });
  }

  revalidatePath(here);
  redirect(`${here}?standard=confirmed`);
}
