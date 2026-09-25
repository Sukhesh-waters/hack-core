import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { assembleActionPacket } from "@/lib/platina/export/load";

/**
 * The versioned JSON action packet (W0.5 contract) as a download.
 * Membership-checked; assembly is workspace-scoped throughout.
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

  return new Response(JSON.stringify(packet, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="platina-packet-${packet.packetId}.json"`,
    },
  });
}
