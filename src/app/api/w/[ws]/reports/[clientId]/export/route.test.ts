import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const requireMembership = vi.fn();
const getClientById = vi.fn();
const listClientPerformance = vi.fn();
const listFormatPerformance = vi.fn();
const countNextMonthScheduled = vi.fn();
const topMoversQuery = vi.fn();

vi.mock("@/auth", () => ({
  requireUser: () => requireUser(),
}));

vi.mock("@/db/queries/memberships", () => ({
  requireMembership: (ws: string, u: string) => requireMembership(ws, u),
}));

vi.mock("@/db/queries/clients", () => ({
  getClientById: (ws: string, id: string) => getClientById(ws, id),
}));

vi.mock("@/db/queries/analytics", () => ({
  listClientPerformance: (ws: string) => listClientPerformance(ws),
  listFormatPerformance: (ws: string, id: string) =>
    listFormatPerformance(ws, id),
  countNextMonthScheduled: (
    ws: string,
    id: string,
    start: Date,
    end: Date,
  ) => countNextMonthScheduled(ws, id, start, end),
}));

vi.mock("@/db/queries/posts", () => ({
  topMoversQuery: (
    ws: string,
    id: string,
    dir: "up" | "down",
    lim: number,
  ) => topMoversQuery(ws, id, dir, lim),
}));

import { GET } from "./route";

describe("GET /api/w/[ws]/reports/[clientId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "usr_1" });
    requireMembership.mockResolvedValue(undefined);
    getClientById.mockResolvedValue({
      id: "cli_1",
      name: "Acme Corp",
      handle: "@acme",
    });
    listClientPerformance.mockResolvedValue([
      {
        clientId: "cli_1",
        name: "Acme Corp",
        posts: 20,
        scored: 18,
        avgEngagement: 0.052,
      },
    ]);
    listFormatPerformance.mockResolvedValue([
      { format: "reel", count: 10, avgEngagement: 0.06 },
    ]);
    countNextMonthScheduled.mockResolvedValue(3);
    topMoversQuery.mockResolvedValue([]);
  });

  it("returns 404 when client does not exist", async () => {
    getClientById.mockResolvedValue(null);
    const req = new Request("http://localhost/api/w/ws_1/reports/cli_missing/export");
    const res = await GET(req, { params: Promise.resolve({ ws: "ws_1", clientId: "cli_missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 401 when membership fails", async () => {
    requireMembership.mockRejectedValue(new Error("Not a member"));
    const req = new Request("http://localhost/api/w/ws_1/reports/cli_1/export");
    const res = await GET(req, { params: Promise.resolve({ ws: "ws_1", clientId: "cli_1" }) });
    expect(res.status).toBe(401);
  });

  it("returns CSV with correct attachment headers and body", async () => {
    const req = new Request("http://localhost/api/w/ws_1/reports/cli_1/export");
    const res = await GET(req, { params: Promise.resolve({ ws: "ws_1", clientId: "cli_1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain(
      'attachment; filename="report-acme-corp-',
    );

    const body = await res.text();
    expect(body).toContain("Performance Report,Acme Corp");
    expect(body).toContain("Handle,@acme");
    expect(body).toContain("Posts Tracked,20");
    expect(body).toContain("Scored Posts,18");
    expect(body).toContain("Average Engagement,5.2%");
    expect(body).toContain("reel,10,6.0%");
  });
});
