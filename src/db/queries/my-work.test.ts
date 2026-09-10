import { describe, expect, it } from "vitest";
import {
  myContentQuery,
  myTicketsQuery,
  mySopStepsQuery,
  sortMyWork,
  type MyWorkItem,
} from "./my-work";

describe("myContentQuery (S7)", () => {
  const { sql, params } = myContentQuery("ws_1", "user_1").toSQL();

  it("is scoped by workspace AND assignee", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"assignee_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("user_1");
  });

  it("excludes cards that are not on a board yet", () => {
    expect(sql.toLowerCase()).toContain("is not null");
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("myTicketsQuery (S7)", () => {
  const { sql, params } = myTicketsQuery("ws_1", "user_1").toSQL();

  it("is scoped by workspace AND assignee", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"assignee_id" =');
    expect(params).toContain("user_1");
  });

  it("excludes terminal statuses — done is not work", () => {
    expect(params).toContain("open");
    expect(params).toContain("in_progress");
    expect(params).toContain("blocked");
    expect(params).not.toContain("done");
  });

  it("LEFT JOINs clients so a ticket with no client still appears", () => {
    expect(sql.toLowerCase()).toContain("left join");
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("mySopStepsQuery (E2)", () => {
  const { sql, params } = mySopStepsQuery("ws_1", "user_1").toSQL();

  it("is scoped by workspace AND assignee", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"assignee_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("user_1");
  });

  it("filters for active SOP statuses in active runs", () => {
    expect(params).toContain("ready");
    expect(params).toContain("in_progress");
    expect(params).toContain("blocked");
    expect(params).toContain("active");
  });

  it("joins sopRuns and left joins clients", () => {
    expect(sql.toLowerCase()).toContain("join");
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("sortMyWork — merge ordering (S7 / E2)", () => {
  const item = (
    title: string,
    dueAt: Date | null,
    kind: "content" | "ticket" | "sop_step" = "content",
  ): MyWorkItem => ({
    kind,
    id: title,
    title,
    clientName: null,
    status: "open",
    dueAt,
    href: "#",
  });

  it("puts the soonest deadline first", () => {
    const sorted = sortMyWork([
      item("later", new Date("2026-09-01")),
      item("sooner", new Date("2026-08-01")),
    ]);
    expect(sorted.map((i) => i.title)).toEqual(["sooner", "later"]);
  });

  it("sorts undated work last rather than treating it as urgent", () => {
    const sorted = sortMyWork([
      item("undated", null),
      item("dated", new Date("2026-09-01")),
    ]);
    expect(sorted.map((i) => i.title)).toEqual(["dated", "undated"]);
  });

  it("interleaves drafts, tickets, and sop steps by date, not by source", () => {
    const sorted = sortMyWork([
      item("draft-late", new Date("2026-09-01"), "content"),
      item("ticket-early", new Date("2026-08-01"), "ticket"),
      item("step-mid", new Date("2026-08-10"), "sop_step"),
      item("draft-mid", new Date("2026-08-15"), "content"),
    ]);
    expect(sorted.map((i) => i.title)).toEqual([
      "ticket-early",
      "step-mid",
      "draft-mid",
      "draft-late",
    ]);
  });

  it("is stable on ties so the order doesn't shuffle between loads", () => {
    const same = new Date("2026-08-01");
    const sorted = sortMyWork([item("b", same), item("a", same)]);
    expect(sorted.map((i) => i.title)).toEqual(["a", "b"]);
  });
});
