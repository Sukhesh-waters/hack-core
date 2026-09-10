import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { getSprintDeckQuery } from "@/db/queries/sprint";
import { PageShell } from "@/components/page-shell";
import { SprintCommandDeck } from "../sprint-command-deck";

export const metadata = { title: "Campaign Sprint Command Deck | InstaMedia AI" };
export const dynamic = "force-dynamic";

export default async function SprintDeckPage({
  params,
}: {
  params: { ws: string; runId: string };
}) {
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
