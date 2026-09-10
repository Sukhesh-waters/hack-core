const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hhmm(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Chat timestamps: "just now" → "HH:MM" (today) → "Mon d". */
export function formatHubTime(date: Date, now: Date = new Date()): string {
  if (now.getTime() - date.getTime() < 60_000) return "just now";
  if (sameDay(date, now)) return hhmm(date);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Reminder due labels: "Today HH:MM" / "Tomorrow HH:MM" / "Fri HH:MM". */
export function formatDue(date: Date, now: Date = new Date()): string {
  if (sameDay(date, now)) return `Today ${hhmm(date)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, tomorrow)) return `Tomorrow ${hhmm(date)}`;
  return `${DAYS[date.getDay()]} ${hhmm(date)}`;
}
