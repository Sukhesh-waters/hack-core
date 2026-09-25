/** Reminder email content — pure, testable, no I/O. */

export const REMINDER_HORIZON_HOURS = 24;

/** The Resend rejection shape the sweeps classify. Structural on purpose:
 *  `ErrorResponse` passes straight through and the tests need no SDK. */
export type SendFailure = {
  name: string;
  statusCode?: number | null;
};

/** Rejections where the request itself is unacceptable, so replaying the
 *  identical payload can only fail the same way.
 *
 *  Deliberately excludes the environment-level codes — missing/invalid API
 *  key, quota, rate limit, server error. Those fail every row equally and
 *  start succeeding once the account or the outage is fixed, so giving up on
 *  a row because of one would discard a reminder a retry would have sent. */
const PERMANENT_SEND_FAILURES: ReadonlySet<string> = new Set([
  "validation_error",
  "invalid_from_address",
  "invalid_attachment",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "not_found",
  "method_not_allowed",
]);

/** True when a sweep should stop replaying a failed send.
 *
 *  Stamping on `true` trades the send away: the row is never retried, even
 *  if the cause (an unverified sender domain, say) is fixed later. That is
 *  the point — an unstamped row is re-sent every 15 minutes forever, and a
 *  permanent rejection never becomes a success. The logged error is the
 *  only record that the email did not go out. */
export function isPermanentSendFailure(failure: SendFailure): boolean {
  if (PERMANENT_SEND_FAILURES.has(failure.name)) return true;
  // Unrecognised code: fall back to the status class. 4xx means the request
  // was refused, except 408/429 which explicitly mean try again; 5xx is the
  // server's problem; a null status means the call never got an answer.
  const status = failure.statusCode;
  if (status == null) return false;
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

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
      `<p>— Platina AI OS Team Hub</p>`,
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
      `<p>Open Platina AI OS to grab the final caption, script, and hashtags.</p>`,
      ...(unassigned
        ? [
            `<p><em>Nobody is assigned to this one yet, so the whole team got this. Assign an owner to stop that.</em></p>`,
          ]
        : []),
    ].join("\n"),
  };
}
