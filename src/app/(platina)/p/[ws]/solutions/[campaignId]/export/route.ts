import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { assembleActionPacket } from "@/lib/platina/export/load";
import { renderPacketHtml } from "@/lib/platina/export/print";

/**
 * The printable action packet: a self-contained HTML document served by a
 * route handler so it renders without the app shell — zero external
 * requests, browser Save-as-PDF faithful.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ ws: string; campaignId: string }> }
) {
  const params = await props.params;
  const user = await requireUser();
  try {
    await requireMembership(params.ws, user.id);
  } catch {
    notFound();
  }
  const packet = await assembleActionPacket(params.ws, params.campaignId, user.id);
  if (!packet) notFound();

  return new Response(renderPacketHtml(packet), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `inline; filename="platina-packet-${params.campaignId}.html"`,
    },
  });
}
