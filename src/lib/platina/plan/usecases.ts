/**
 * Use-case planning (real-time planning). A plan starts from the situation the
 * team is actually in — a competitor just moved, an event is coming, a client
 * is launching — not from a blank box. Each builder turns that situation into
 * the same two-line brief the planner already understands, plus the facts the
 * planner must respect (a fixed date, the client). Pure: no IO, no clock
 * (callers pass `now`).
 */
import type { PlanOrigin } from "@/db/platina-schema";
import { BRIEF_MAX_CHARS, BRIEF_MAX_LINES } from "./brief";
import { MAX_PLAN_DAYS } from "./agent";

export type PlanRequest = {
  brief: string;
  origin: PlanOrigin;
  /** Days from today to a date the plan must land on. */
  anchorDay?: number;
};

export class UseCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UseCaseError";
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Shortens on a word boundary so a long finding can never break the brief limits. */
export function fit(text: string, max: number): string {
  const clean = oneLine(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, Math.max(0, max - 1));
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Joins at most BRIEF_MAX_LINES lines and guarantees the total fits. */
function twoLines(first: string, second: string): string {
  const budget = BRIEF_MAX_CHARS - 1; // the newline
  const a = fit(first, Math.floor(budget * 0.45));
  const b = fit(second, budget - a.length);
  const lines = [a, b].filter(Boolean).slice(0, BRIEF_MAX_LINES);
  return lines.join("\n");
}

/** Whole days from `now` to `date`, counting today as day 0. */
export function daysUntil(date: Date | string, now: Date): number {
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) {
    throw new UseCaseError("That date doesn't look right.");
  }
  const startOf = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOf(target) - startOf(now)) / 86_400_000);
}

export function briefFromFinding(input: {
  findingId: string;
  title: string;
  summary: string;
  clientName?: string | null;
}): PlanRequest {
  const who = input.clientName ? `${input.clientName}` : "our client";
  return {
    brief: twoLines(
      `Respond to a competitor move: ${input.title}.`,
      `What we saw: ${input.summary} Goal: protect ${who}'s position.`,
    ),
    origin: {
      kind: "finding",
      refId: input.findingId,
      label: `Response to “${fit(input.title, 60)}”`,
    },
  };
}

export function briefFromEvent(input: {
  name: string;
  date: Date | string;
  now: Date;
  clientName?: string | null;
}): PlanRequest {
  const name = oneLine(input.name);
  if (name.length < 3) throw new UseCaseError("Name the event.");
  const day = daysUntil(input.date, input.now);
  if (day < 1) throw new UseCaseError("The event date must be in the future.");
  if (day > MAX_PLAN_DAYS) {
    throw new UseCaseError(
      `Plans run at most ${MAX_PLAN_DAYS} days; that event is ${day} days away. Plan closer to the date.`,
    );
  }
  const who = input.clientName ? ` for ${input.clientName}` : "";
  return {
    brief: twoLines(
      `Get ready for ${name}${who}.`,
      `The event is in ${day} days; the campaign must peak on that day.`,
    ),
    origin: { kind: "event", refId: name, label: `${name} (day ${day})`, anchorDay: day },
    anchorDay: day,
  };
}

export function briefFromClient(input: {
  clientName: string;
  goal: string;
}): PlanRequest {
  const goal = oneLine(input.goal);
  if (goal.length < 10) {
    throw new UseCaseError("Add a little more detail: what is the goal?");
  }
  return {
    brief: twoLines(`Campaign for ${input.clientName}.`, `Goal: ${goal}`),
    origin: { kind: "client", label: `Campaign for ${input.clientName}` },
  };
}

/**
 * Remaining days to a fixed date when re-planning later. Null means the date
 * has passed and the plan can no longer be revised toward it.
 */
export function remainingAnchor(
  origin: PlanOrigin | null,
  createdAt: Date,
  now: Date,
): number | null | undefined {
  if (origin?.anchorDay === undefined) return undefined;
  const left = origin.anchorDay - Math.max(0, daysUntil(now, createdAt));
  return left >= 1 ? left : null;
}
