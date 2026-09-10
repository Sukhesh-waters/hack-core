import { describe, expect, it } from "vitest";
import {
  buildHubReminderEmail,
  buildReminderEmail,
  hubReminderStatus,
  reminderHorizon,
  REMINDER_HORIZON_HOURS,
} from "./reminders";

describe("reminderHorizon", () => {
  it("is exactly 24h ahead", () => {
    const now = new Date("2026-07-05T12:00:00Z");
    expect(reminderHorizon(now).getTime() - now.getTime()).toBe(
      REMINDER_HORIZON_HOURS * 3_600_000,
    );
  });
});

describe("buildReminderEmail", () => {
  it("subject and body carry the title and the slot time", () => {
    const { subject, html } = buildReminderEmail({
      title: "Roastery reel",
      scheduledFor: new Date(2026, 6, 10, 9, 30),
    });
    expect(subject).toContain("Roastery reel");
    expect(subject).toContain("9:30");
    expect(html).toContain("Roastery reel");
    expect(html).toContain("9:30");
  });
});

describe("buildReminderEmail — unassigned fallback (S10)", () => {
  const slot = {
    title: "Barrier repair basics",
    scheduledFor: new Date("2026-08-15T10:00:00Z"),
  };

  it("says so when the whole team was mailed because nobody owns it", () => {
    const { html } = buildReminderEmail(slot, true);
    expect(html).toMatch(/nobody is assigned/i);
    expect(html).toMatch(/assign an owner/i);
  });

  it("stays personal when the reminder went to the owner", () => {
    const { html } = buildReminderEmail(slot, false);
    expect(html).not.toMatch(/nobody is assigned/i);
  });

  it("defaults to the personal wording", () => {
    expect(buildReminderEmail(slot).html).not.toMatch(/nobody is assigned/i);
  });
});

describe("buildHubReminderEmail (C1s)", () => {
  it("subject and body carry the title, due time, and owner name", () => {
    const { subject, html } = buildHubReminderEmail({
      title: "Follow up with Aurora Skincare",
      dueAt: new Date(2026, 6, 10, 9, 30),
      ownerName: "Priya",
    });
    expect(subject).toContain("Follow up with Aurora Skincare");
    expect(subject).toContain("9:30");
    expect(html).toContain("Follow up with Aurora Skincare");
    expect(html).toContain("Priya");
  });

  it("falls back to a generic greeting when the owner has no name", () => {
    const { html } = buildHubReminderEmail({
      title: "Renew brand license",
      dueAt: new Date(2026, 6, 10, 9, 30),
      ownerName: null,
    });
    expect(html).toContain("Hi there,");
  });
});

describe("hubReminderStatus (C1s)", () => {
  const now = new Date("2026-08-08T12:00:00Z");

  it("is overdue when due in the past and never notified", () => {
    const status = hubReminderStatus(
      new Date("2026-08-08T09:00:00Z"),
      null,
      now,
    );
    expect(status).toEqual({ overdue: true, notified: false });
  });

  it("is not overdue once notified, even past due", () => {
    const status = hubReminderStatus(
      new Date("2026-08-08T09:00:00Z"),
      new Date("2026-08-08T09:15:00Z"),
      now,
    );
    expect(status).toEqual({ overdue: false, notified: true });
  });

  it("is not overdue when due in the future", () => {
    const status = hubReminderStatus(
      new Date("2026-08-08T18:00:00Z"),
      null,
      now,
    );
    expect(status).toEqual({ overdue: false, notified: false });
  });
});
