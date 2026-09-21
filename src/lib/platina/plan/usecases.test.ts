import { describe, expect, it, vi } from "vitest";
import { briefSchema, BRIEF_MAX_CHARS } from "./brief";
import {
  briefFromClient,
  briefFromEvent,
  briefFromFinding,
  daysUntil,
  fit,
  remainingAnchor,
  UseCaseError,
} from "./usecases";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));

const NOW = new Date("2026-09-20T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("fit", () => {
  it("leaves short text alone and shortens long text on a word boundary", () => {
    expect(fit("  hello   world ", 50)).toBe("hello world");
    const cut = fit("alpha beta gamma delta epsilon zeta", 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });
});

describe("daysUntil", () => {
  it("counts whole calendar days, today being day 0", () => {
    expect(daysUntil(NOW, NOW)).toBe(0);
    expect(daysUntil(inDays(30), NOW)).toBe(30);
    expect(daysUntil(inDays(-2), NOW)).toBe(-2);
  });

  it("accepts ISO strings and rejects nonsense", () => {
    expect(daysUntil("2026-10-20", NOW)).toBe(30);
    expect(() => daysUntil("not a date", NOW)).toThrow(UseCaseError);
  });
});

describe("briefFromFinding", () => {
  const base = { findingId: "f1", title: "Rival launches a 48-hour guarantee", summary: "They ship within 48 hours of roasting.", clientName: "Northwind" };

  it("makes a two-line brief that satisfies the planner's own brief contract", () => {
    const req = briefFromFinding(base);
    expect(briefSchema.safeParse(req.brief).success).toBe(true);
    expect(req.brief).toContain("Northwind");
    expect(req.origin).toMatchObject({ kind: "finding", refId: "f1" });
  });

  it("can never exceed the brief limits, however long the finding is", () => {
    const req = briefFromFinding({ ...base, title: "T".repeat(500), summary: "word ".repeat(400) });
    expect(req.brief.length).toBeLessThanOrEqual(BRIEF_MAX_CHARS);
    expect(req.brief.split("\n").length).toBeLessThanOrEqual(2);
    expect(briefSchema.safeParse(req.brief).success).toBe(true);
  });

  it("does not invent a client when the finding has none", () => {
    expect(briefFromFinding({ ...base, clientName: null }).brief).toContain("our client");
  });
});

describe("briefFromEvent", () => {
  it("anchors the plan to the number of days away", () => {
    const req = briefFromEvent({ name: "Roast Day", date: inDays(30), now: NOW, clientName: "Northwind" });
    expect(req.anchorDay).toBe(30);
    expect(req.origin).toMatchObject({ kind: "event", anchorDay: 30 });
    expect(req.brief).toContain("30 days");
    expect(briefSchema.safeParse(req.brief).success).toBe(true);
  });

  it("refuses a past or same-day date, a missing name, and a date beyond the plan limit", () => {
    expect(() => briefFromEvent({ name: "X Event", date: inDays(0), now: NOW })).toThrow(/future/);
    expect(() => briefFromEvent({ name: "X Event", date: inDays(-3), now: NOW })).toThrow(/future/);
    expect(() => briefFromEvent({ name: "  ", date: inDays(5), now: NOW })).toThrow(/Name the event/);
    expect(() => briefFromEvent({ name: "Far Event", date: inDays(400), now: NOW })).toThrow(/at most 180/);
  });
});

describe("briefFromClient", () => {
  it("builds a client-scoped brief and requires a real goal", () => {
    const req = briefFromClient({ clientName: "Northwind", goal: "Win back lapsed subscribers before the holidays" });
    expect(req.brief).toContain("Northwind");
    expect(briefSchema.safeParse(req.brief).success).toBe(true);
    expect(() => briefFromClient({ clientName: "Northwind", goal: "grow" })).toThrow(UseCaseError);
  });
});

describe("remainingAnchor", () => {
  const origin = { kind: "event" as const, label: "Roast Day", anchorDay: 30 };

  it("is undefined when the plan has no fixed date", () => {
    expect(remainingAnchor({ kind: "brief", label: "x" }, NOW, NOW)).toBeUndefined();
    expect(remainingAnchor(null, NOW, NOW)).toBeUndefined();
  });

  it("shrinks as time passes, so a revision plans toward the same real date", () => {
    expect(remainingAnchor(origin, NOW, NOW)).toBe(30);
    expect(remainingAnchor(origin, NOW, inDays(10))).toBe(20);
  });

  it("is null once the date has passed — the plan can no longer be revised toward it", () => {
    expect(remainingAnchor(origin, NOW, inDays(30))).toBeNull();
    expect(remainingAnchor(origin, NOW, inDays(45))).toBeNull();
  });
});
