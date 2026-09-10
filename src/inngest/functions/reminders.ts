import { inngest } from "@/inngest/client";
import {
  emailsForUsers,
  listImmediateMemberEmails,
} from "@/db/queries/memberships";
import { dueRemindersQuery, markReminderSent } from "@/db/queries/schedule";
import { buildReminderEmail, reminderHorizon } from "@/lib/reminders";
import { resend } from "@/lib/resend";

/**
 * Publish-reminder sweep (W6): every 15 minutes, find slots due within 24h
 * with no reminder sent, email that workspace's members, stamp the row.
 * Per-row failures are logged and skipped — the sweep never dies mid-batch,
 * and unstamped rows are retried on the next tick.
 */
export const contentReminder = inngest.createFunction(
  { id: "content-reminder", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const due = await step.run("find-due-slots", () =>
      dueRemindersQuery(reminderHorizon(new Date())),
    );

    let sent = 0;
    for (const slot of due) {
      await step.run(`remind-${slot.id}`, async () => {
        // The owner gets the reminder. Falling back to everyone is only
        // correct when nobody owns it — and the email says so, so an
        // unowned slot doesn't quietly become everyone-assumes-someone-else.
        const ownerId = slot.assigneeId;
        const to = ownerId
          ? await emailsForUsers(slot.workspaceId, [ownerId])
          : await listImmediateMemberEmails(slot.workspaceId);
        const unassigned = !ownerId;
        // Nobody to mail — either the owner set digest "off" or the
        // workspace has no immediate recipients. Stamp it anyway below so
        // the sweep doesn't retry this slot forever.
        const { subject, html } = buildReminderEmail(
          {
            title: slot.title,
            scheduledFor: new Date(slot.scheduledFor),
          },
          unassigned,
        );
        if (to.length === 0) {
          await markReminderSent(slot.id, new Date());
          return;
        }
        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || "onboarding@resend.dev",
          to,
          subject,
          html,
        });
        if (error) {
          console.error(`reminder ${slot.id} send failed:`, error);
          return;
        }
        await markReminderSent(slot.id, new Date());
        sent += 1;
      });
    }
    return { due: due.length, sent };
  },
);
