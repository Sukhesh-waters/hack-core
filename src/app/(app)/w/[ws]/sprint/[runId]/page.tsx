import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { getSprintDeckQuery } from "@/db/queries/sprint";
import { PageShell } from "@/components/page-shell";
import { SprintCommandDeck } from "../sprint-command-deck";

export const metadata = { title: "Campaign Sprint Command Deck | Platina AI OS" };
export const dynamic = "force-dynamic";

export default async function SprintDeckPage(
  props: {
    params: Promise<{ ws: string; runId: string }>;
  }
) {
  const params = await props.params;
  await requireUser();
  const deckData = await getSprintDeckQuery(params.ws, params.runId);

  if (!deckData) {
    notFound();
  }

  return (
    <PageShell width="full">
      <SprintCommandDeck workspaceId={params.ws} data={deckData} />
    </PageShell>
  );
}
