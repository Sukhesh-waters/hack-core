"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { brandProfiles, clients } from "@/db/schema";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { clientWithContextSchema } from "@/lib/validation";

export type CreateClientState = { error?: string } | undefined;

/**
 * Intake wizard final submit: one transaction — insert the client and its
 * brand profile with the human-declared context (status "declared"). CSV is
 * an add-on, not a prerequisite: we land on the Brand DNA screen, not import.
 */
export async function createClientWithContext(
  _prev: CreateClientState,
  formData: FormData,
): Promise<CreateClientState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Malformed intake payload — reload and try again." };
  }
  const parsed = clientWithContextSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const { workspaceId, name, handle, context } = parsed.data;

  let clientId: string;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    clientId = await db.transaction(async (tx) => {
      const [client] = await tx
        .insert(clients)
        .values({ workspaceId, name, handle: handle ?? null })
        .returning({ id: clients.id });
      await tx.insert(brandProfiles).values({
        workspaceId,
        clientId: client.id,
        declared: context,
        status: "declared",
      });
      return client.id;
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  redirect(`/w/${workspaceId}/clients/${clientId}/brand`);
}
