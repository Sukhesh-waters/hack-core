import { inngest } from "@/inngest/client";
import { listDueUnnotifiedReminders, markReminderNotified } from "@/db/queries/hub";
import { buildHubReminderEmail } from "@/lib/reminders";
import { resend } from "@/lib/resend";

/**
 * Team Hub reminder sweep (C1s / manual-audit lines 11, 13). Every 15
 * minutes, find due-and-unnotified hub_reminders, email the owner (schema
 * guarantees one — no unassigned-fallback branch needed), stamp
 * notified_at. Per-item try/catch: one bad row never kills the sweep, and
 * an unstamped row is retried on the next tick.
 */
export const hubReminderSweep = inngest.createFunction(
  { id: "hub-reminder-sweep", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const due = await step.run("find-due-reminders", () =>
      listDueUnnotifiedReminders(),
    );

    let sent = 0;
    for (const reminder of due) {
      await step.run(`remind-${reminder.id}`, async () => {
        try {
          const { subject, html } = buildHubReminderEmail({
            title: reminder.title,
            dueAt: new Date(reminder.dueAt),
            ownerName: reminder.ownerName,
          });
          const { error } = await resend.emails.send({
            from: process.env.EMAIL_FROM || "onboarding@resend.dev",
            to: reminder.ownerEmail,
            subject,
            html,
          });
          if (error) {
            console.error(`hub reminder ${reminder.id} send failed:`, error);
            return;
          }
          sent += 1;
        } catch (error) {
          console.error(`hub reminder ${reminder.id} failed:`, error);
        } finally {
          await markReminderNotified(reminder.workspaceId, reminder.id);
        }
      });
    }
    return { due: due.length, sent };
  },
);
