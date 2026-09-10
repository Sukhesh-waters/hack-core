"use server";

import { revalidatePath } from "next/cache";
import { getClientById, setClientContactEmail } from "@/db/queries/clients";
import {
  listImmediateMemberEmails,
  requireMembership,
} from "@/db/queries/memberships";
import { logReportSend } from "@/db/queries/report-sends";
import { requireUser } from "@/auth";
import { actionErrorMessage } from "@/lib/action-errors";
import { contactEmailSchema, sendReportSchema } from "@/lib/report-schemas";
import { buildReportEmail } from "@/lib/reports";
import { resend } from "@/lib/resend";

export type SendReportState = { error?: string; ok?: string } | undefined;

export async function sendReportAction(
  _prev: SendReportState,
  formData: FormData,
): Promise<SendReportState> {
  const parsed = sendReportSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    audience: formData.get("audience"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId, audience, body } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found." };

    const to =
      audience === "team"
        ? await listImmediateMemberEmails(workspaceId)
        : client.contactEmail
          ? [client.contactEmail]
          : [];
    if (audience === "team" && to.length === 0) {
      return { error: "No team members to send to." };
    }
    if (audience === "client" && to.length === 0) {
      return {
        error:
          "No client contact email on file — add one in client settings.",
      };
    }

    const { subject, html } = buildReportEmail({ clientName: client.name, body });

    let sendError: string | null = null;
    try {
      const { error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to,
        subject,
        html,
      });
      if (error) sendError = error.message ?? "Send failed.";
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
    }

    const status = sendError ? "failed" : "sent";
    const resultMessage = sendError
      ? "Send failed — check email configuration."
      : "Report sent.";

    try {
      await logReportSend({
        workspaceId,
        clientId,
        sentByUserId: user.id,
        recipients: to,
        audience,
        subject,
        body,
        status,
        error: sendError ?? undefined,
      });
    } catch {
      // A failure to log the attempt must not mask the actual send result —
      // surface it as a suffix, not swap it in for the real outcome.
      revalidatePath(`/w/${workspaceId}/reports`);
      return sendError
        ? { error: `${resultMessage} (send log failed)` }
        : { ok: `${resultMessage} (send log failed)` };
    }

    revalidatePath(`/w/${workspaceId}/reports`);
    return sendError ? { error: resultMessage } : { ok: resultMessage };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

export type UpdateContactEmailState =
  | { error?: string; ok?: string }
  | undefined;

export async function updateClientContactEmailAction(
  _prev: UpdateContactEmailState,
  formData: FormData,
): Promise<UpdateContactEmailState> {
  const workspaceId = formData.get("workspaceId");
  const clientId = formData.get("clientId");
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  if (typeof clientId !== "string" || clientId.length === 0) {
    return { error: "Missing client" };
  }

  const parsed = contactEmailSchema.safeParse(
    formData.get("contactEmail") ?? "",
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const found = await setClientContactEmail(
      workspaceId,
      clientId,
      parsed.data,
    );
    if (!found) return { error: "Client not found." };

    revalidatePath(`/w/${workspaceId}/reports`);
    return { ok: "Contact email saved." };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
