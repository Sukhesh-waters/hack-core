/**
 * What changed between two versions of the same page (core spine R1). Pure.
 *
 * The pipeline already detects change — the probe fires on ETag/Last-Modified,
 * and the (scan_spec_id, content_hash) unique index means a changed page
 * inserts a new row while the previous row survives. Until now nothing
 * compared the two, so the most valuable competitor signal available —
 * *they changed their pricing page* — was collected and thrown away.
 *
 * Line-level and deliberately simple: an LLM reads the output, not a human
 * reviewing a patch. No dependency, no IO, no clock.
 */

export type ChangeSide = { title: string | null; body: string; fetchedAt: Date | string };

export type ChangeSummary = {
  added: string[];
  removed: string[];
  /** Model-readable prose, bounded. Always states the age of the previous version. */
  summary: string;
};

export const DEFAULT_CHANGE_BUDGET = 1200;
/** Lines shorter than this are menu items; they move around without meaning. */
const MIN_MEANINGFUL_LINE = 25;

const lines = (body: string): string[] =>
  body
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

/** Digits masked out: "£12.00 / month" and "£14.00 / month" become one shape. */
const shape = (line: string) => line.replace(/\d+([.,]\d+)?/g, "#");

const ageInDays = (from: Date | string, to: Date | string): number => {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
};

function take(items: string[], budget: number): { kept: string[]; truncated: number } {
  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    if (used + item.length > budget) break;
    kept.push(item);
    used += item.length;
  }
  return { kept, truncated: items.length - kept.length };
}

/**
 * Returns null when nothing meaningful changed — identical text, or only
 * numbers inside otherwise identical lines (a visitor counter, a "last
 * updated" stamp, a rotating testimonial index). A null must be passed on as
 * null: an empty change section would tell the model "nothing changed" in the
 * same breath as "this changed".
 */
export function summariseChange(
  previous: ChangeSide,
  current: ChangeSide,
  budgetChars: number = DEFAULT_CHANGE_BUDGET,
): ChangeSummary | null {
  const before = lines(previous.body);
  const after = lines(current.body);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  const added = after.filter((line) => !beforeSet.has(line));
  const removed = before.filter((line) => !afterSet.has(line));
  const titleChanged =
    (previous.title ?? "").trim() !== (current.title ?? "").trim() &&
    Boolean(current.title?.trim());

  if (added.length === 0 && removed.length === 0 && !titleChanged) return null;

  // Cosmetic: every added line is a removed line with different digits.
  const removedShapes = new Set(removed.map(shape));
  const substantive = added.filter(
    (line) => !removedShapes.has(shape(line)) && line.length >= MIN_MEANINGFUL_LINE,
  );
  const addedShapes = new Set(added.map(shape));
  const substantiveRemoved = removed.filter(
    (line) => !addedShapes.has(shape(line)) && line.length >= MIN_MEANINGFUL_LINE,
  );
  if (substantive.length === 0 && substantiveRemoved.length === 0 && !titleChanged) {
    return null;
  }

  const days = ageInDays(previous.fetchedAt, current.fetchedAt);
  const when =
    days === 0 ? "since earlier today" : days === 1 ? "since yesterday" : `since ${days} days ago`;

  const half = Math.floor(budgetChars / 2);
  const addedTake = take(substantive, half);
  const removedTake = take(substantiveRemoved, budgetChars - half);

  const parts: string[] = [
    `This page changed ${when}: ${substantive.length} new line(s), ${substantiveRemoved.length} removed.`,
  ];
  if (titleChanged) {
    parts.push(`Title is now "${current.title}" (was "${previous.title ?? "untitled"}").`);
  }
  if (addedTake.kept.length > 0) {
    parts.push(
      `NEW:\n${addedTake.kept.map((l) => `+ ${l}`).join("\n")}` +
        (addedTake.truncated > 0 ? `\n+ (…${addedTake.truncated} more)` : ""),
    );
  }
  if (removedTake.kept.length > 0) {
    parts.push(
      `GONE:\n${removedTake.kept.map((l) => `- ${l}`).join("\n")}` +
        (removedTake.truncated > 0 ? `\n- (…${removedTake.truncated} more)` : ""),
    );
  }

  return {
    added: substantive,
    removed: substantiveRemoved,
    summary: parts.join("\n"),
  };
}
