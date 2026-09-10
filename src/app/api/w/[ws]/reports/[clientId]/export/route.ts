import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getClientById } from "@/db/queries/clients";
import {
  countNextMonthScheduled,
  listClientPerformance,
  listFormatPerformance,
} from "@/db/queries/analytics";
import { topMoversQuery } from "@/db/queries/posts";
import { buildReportCsv, nextMonthRange } from "@/lib/reports";
import { MIN_BASELINE_N } from "@/lib/scoring";

export async function GET(
  _request: Request,
  { params }: { params: { ws: string; clientId: string } },
) {
  try {
    const user = await requireUser();
    await requireMembership(params.ws, user.id);

    const client = await getClientById(params.ws, params.clientId);
    if (!client) {
      return new NextResponse("Client not found", { status: 404 });
    }

    const rollup = await listClientPerformance(params.ws);
    const clientPerf = rollup.find((c) => c.clientId === params.clientId);

    const now = new Date();
    const { start, end } = nextMonthRange(now);
    const monthLabel = start.toLocaleDateString("en-US", { month: "long" });

    const [up, down, formats, nextMonthScheduled] = await Promise.all([
      topMoversQuery(params.ws, params.clientId, "up", 10),
      topMoversQuery(params.ws, params.clientId, "down", 10),
      listFormatPerformance(params.ws, params.clientId),
      countNextMonthScheduled(params.ws, params.clientId, start, end),
    ]);

    const posts = clientPerf?.posts ?? 0;
    const scored = clientPerf?.scored ?? 0;
    const avgEngagement = clientPerf?.avgEngagement ?? null;
    const insufficient = posts < MIN_BASELINE_N;

    const csv = buildReportCsv({
      clientName: client.name,
      clientHandle: client.handle,
      generatedAt: now,
      posts,
      scored,
      avgEngagement,
      insufficient,
      formats,
      topDrivers: up,
      underperformers: down,
      nextMonthScheduled,
      monthLabel,
    });

    const slug = client.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const dateStr = now.toISOString().slice(0, 10);
    const filename = `report-${slug || "client"}-${dateStr}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return new NextResponse(message, { status: 401 });
  }
}
