import { inngest } from "@/inngest/client";
import { listDueUnnotifiedReminders, markReminderNotified } from "@/db/queries/hub";
import { buildHubReminderEmail, isPermanentSendFailure } from "@/lib/reminders";
import { resend } from "@/lib/resend";

/**
 * Team Hub reminder sweep (C1s / manual-audit lines 11, 13). Every 15
 * minutes, find due-and-unnotified hub_reminders, email the owner (schema
 * guarantees one — no unassigned-fallback branch needed), stamp
 * notified_at. Per-item try/catch: one bad row never kills the sweep, and
 * an unstamped row is retried on the next tick.
 *
 * notified_at is stamped on delivery and on a permanent rejection alike —
 * both mean the sweep is done with the row. A send that could still succeed
 * (rate limit, outage, dropped connection) is left unstamped for the next
 * tick rather than stamped and silently lost.
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
        // Built outside the try: a row this throws on is a data or code
        // fault, not a delivery failure, and should surface through
        // Inngest's bounded step retries rather than be swallowed here and
        // replayed by the sweep every 15 minutes.
        const { subject, html } = buildHubReminderEmail({
          title: reminder.title,
          dueAt: new Date(reminder.dueAt),
          ownerName: reminder.ownerName,
        });

        let rejection;
        try {
          ({ error: rejection } = await resend.emails.send({
            from: process.env.EMAIL_FROM || "onboarding@resend.dev",
            to: reminder.ownerEmail,
            subject,
            html,
          }));
        } catch (error) {
          // A throw here is transport-level — DNS, socket, aborted request.
          // Nothing about the row is wrong, so leave it for the next tick.
          console.error(`hub reminder ${reminder.id} send threw, will retry:`, error);
          return;
        }

        if (rejection) {
          if (!isPermanentSendFailure(rejection)) {
            console.error(
              `hub reminder ${reminder.id} send failed, will retry:`,
              rejection,
            );
            return;
          }
          console.error(`hub reminder ${reminder.id} rejected, giving up:`, rejection);
        } else {
          sent += 1;
        }
        await markReminderNotified(reminder.workspaceId, reminder.id);
      });
    }
    return { due: due.length, sent };
  },
);
