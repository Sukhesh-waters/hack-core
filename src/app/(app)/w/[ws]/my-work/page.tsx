import { requireUser } from "@/auth";
import { listMyWork } from "@/db/queries/my-work";
import { PageShell } from "@/components/page-shell";
import { MyWorkClient } from "./my-work-client";

export const metadata = { title: "My Work | Platina AI OS" };
export const dynamic = "force-dynamic";

export default async function MyWorkPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const user = await requireUser();
  const items = await listMyWork(params.ws, user.id);

  return (
    <PageShell width="app">
      <div className="mb-6">
        <h1 className="font-display text-3xl text-foreground">My Work</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assigned drafts, tickets, and active SOP steps across all clients, soonest deadline first.
        </p>
      </div>

      <MyWorkClient
        workspaceId={params.ws}
        userId={user.id}
        initialItems={items}
      />
    </PageShell>
  );
}
