/** Reminder email content — pure, testable, no I/O. */

export const REMINDER_HORIZON_HOURS = 24;

export type ReminderSlot = {
  title: string;
  scheduledFor: Date;
};

export function reminderHorizon(now: Date): Date {
  return new Date(now.getTime() + REMINDER_HORIZON_HOURS * 60 * 60 * 1000);
}

/** Overdue badge + "sent" label for a hub reminder row — pure so the
 *  mapper stays a one-liner and the date-comparison logic is testable
 *  without a DB. */
export function hubReminderStatus(
  dueAt: Date,
  notifiedAt: Date | null,
  now: Date = new Date(),
): { overdue: boolean; notified: boolean } {
  return {
    overdue: notifiedAt === null && dueAt.getTime() < now.getTime(),
    notified: notifiedAt !== null,
  };
}

export type HubReminder = {
  title: string;
  dueAt: Date;
  ownerName: string | null;
};

/** Team Hub reminder email — distinct from the publish-slot reminder above:
 *  hub reminders always have an owner (schema-enforced), so there is no
 *  unassigned-fallback branch to cover. */
export function buildHubReminderEmail(reminder: HubReminder): {
  subject: string;
  html: string;
} {
  const when = reminder.dueAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    subject: `Reminder: "${reminder.title}" — ${when}`,
    html: [
      `<p>Hi ${reminder.ownerName ?? "there"},</p>`,
      `<p>Your reminder <strong>"${reminder.title}"</strong> is due at <strong>${when}</strong>.</p>`,
      `<p>— InstaMedia AI Team Hub</p>`,
    ].join("\n"),
  };
}

export function buildReminderEmail(
  slot: ReminderSlot,
  /** True when nobody owns this slot, so the whole team was mailed. The
   *  body says so — an unowned reminder that reads like a personal one
   *  makes everybody assume somebody else has it. */
  unassigned = false,
): {
  subject: string;
  html: string;
} {
  const when = slot.scheduledFor.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    subject: `Publish reminder: “${slot.title}” — ${when}`,
    html: [
      `<p><strong>${slot.title}</strong> is scheduled for <strong>${when}</strong>.</p>`,
      `<p>Open InstaMedia AI to grab the final caption, script, and hashtags.</p>`,
      ...(unassigned
        ? [
            `<p><em>Nobody is assigned to this one yet, so the whole team got this. Assign an owner to stop that.</em></p>`,
          ]
        : []),
    ].join("\n"),
  };
}
