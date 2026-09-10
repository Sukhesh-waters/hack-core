"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { orgs } from "@/db/schema";
import { actionErrorMessage } from "@/lib/action-errors";
import { orgClaimSchema } from "@/lib/validation";

export type ClaimOrgState = { error?: string } | undefined;

export async function claimOrg(
  _prev: ClaimOrgState,
  formData: FormData,
): Promise<ClaimOrgState> {
  const parsed = orgClaimSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let orgId: string;
  try {
    const user = await requireUser();
    const taken = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(eq(orgs.slug, parsed.data.slug))
      .limit(1);
    if (taken.length > 0) {
      return { error: "That slug is already taken — try another." };
    }
    const [org] = await db
      .insert(orgs)
      .values({
        name: parsed.data.name,
        slug: parsed.data.slug,
        ownerUserId: user.id,
      })
      .returning({ id: orgs.id });
    orgId = org.id;
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  redirect(`/workspace/setup?org=${orgId}`);
}
