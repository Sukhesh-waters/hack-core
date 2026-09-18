import { describe, expect, it } from "vitest";
import { buildInbox } from "./inbox";

const NOW = new Date("2026-09-17T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("buildInbox", () => {
  it("orders by severity, then overdue, then freshest first", () => {
    const items = buildInbox(
      {
        findings: [
          { id: "f1", title: "medium finding", severity: "medium", createdAt: at("2026-09-17T10:00:00Z") },
          { id: "f2", title: "critical finding", severity: "critical", createdAt: at("2026-09-16T10:00:00Z") },
        ],
        receipts: [
          { id: "r1", title: "overdue receipt", reviewAt: at("2026-09-10T00:00:00Z") },
          { id: "r2", title: "future receipt", reviewAt: at("2026-12-01T00:00:00Z") },
        ],
        draftSpecs: [{ id: "s1", name: "draft scope", createdAt: at("2026-09-17T11:00:00Z") }],
        draftCampaigns: [],
      },
      "/p/ws",
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual([
      "finding-f2", // critical first
      "receipt-r1", // overdue before
      "receipt-r2", // freshest (Dec) before
      "finding-f1", // the Sep medium finding
      "spec-s1", // draft scope last (lowest rank)
    ]);
  });

  it("deep-links every item to its action surface", () => {
    const items = buildInbox(
      {
        findings: [{ id: "f1", title: "t", severity: "high", createdAt: at("2026-09-17T10:00:00Z") }],
        receipts: [{ id: "r1", title: "t", reviewAt: at("2026-09-10T00:00:00Z") }],
        draftSpecs: [{ id: "s1", name: "t", createdAt: at("2026-09-17T10:00:00Z") }],
        draftCampaigns: [{ id: "c1", title: "t", createdAt: at("2026-09-17T10:00:00Z") }],
      },
      "/p/ws",
      NOW,
    );
    expect(items.find((i) => i.kind === "finding")?.href).toBe("/p/ws/findings?status=needs_decision");
    expect(items.find((i) => i.kind === "receipt")?.href).toBe("/p/ws/outcomes");
    expect(items.find((i) => i.kind === "audit_scope")?.href).toBe("/p/ws/audits");
    expect(items.find((i) => i.kind === "solution")?.href).toBe("/p/ws/solutions/c1");
  });

  it("caps the inbox and handles the empty state", () => {
    expect(
      buildInbox(
        { findings: [], receipts: [], draftSpecs: [], draftCampaigns: [] },
        "/p/ws",
        NOW,
      ),
    ).toEqual([]);
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `f${i}`,
      title: `finding ${i}`,
      severity: "medium",
      createdAt: at("2026-09-17T10:00:00Z"),
    }));
    expect(
      buildInbox(
        { findings: many, receipts: [], draftSpecs: [], draftCampaigns: [] },
        "/p/ws",
        NOW,
      ),
    ).toHaveLength(10);
  });
});
