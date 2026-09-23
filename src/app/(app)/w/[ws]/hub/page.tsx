import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getTeamHubData } from "@/lib/data/team-hub";
import { TeamHubCanvas } from "./team-hub-canvas";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Team Hub" };
export const dynamic = "force-dynamic";

export default async function TeamHubPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const user = await requireUser();
  await requireMembership(params.ws, user.id);
  const data = await getTeamHubData(params.ws);

  return (
    <PageShell width="app">
      <h1 className="font-display text-3xl">Team Hub</h1>
      <p className="mt-1 text-sm text-muted-foreground/70">
        Workspace channel — chat, sign-offs, shared tasks and reminders in one
        canvas.
      </p>
      <div className="mt-6">
        <TeamHubCanvas
          initial={data}
          workspaceId={params.ws}
          me={{ id: user.id, name: user.name ?? user.email ?? "You" }}
        />
      </div>
    </PageShell>
  );
}
