import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { requireUser } from "@/auth";
import { getMembership } from "@/db/queries/memberships";
import { getWorkspaceById } from "@/db/queries/workspaces";
import { listBrands } from "@/db/queries/platina";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Workspace ready" };
export const dynamic = "force-dynamic";

export default async function WorkspaceReadyPage(
  props: {
    searchParams: Promise<{ ws?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!searchParams.ws) redirect("/hub");

  // Isolation rule: only members may see this workspace at all.
  const membership = await getMembership(searchParams.ws, user.id);
  if (!membership) redirect("/hub");

  const workspace = await getWorkspaceById(searchParams.ws);
  if (!workspace) redirect("/hub");

  const hasClients = (await listBrands(workspace.id)).some(
    (b) => b.kind === "own_brand",
  );

  return (
    <div className="mx-auto max-w-lg text-center">
      <CheckCircle2
        className="mx-auto h-12 w-12 text-brand-success"
        aria-hidden
      />
      <p className="label-mono mt-4 text-brand-success">Workspace ready</p>
      <h1 className="mt-2 font-display text-4xl">{workspace.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        You&apos;re in as{" "}
        <span className="font-mono text-brand-purple">{membership.role}</span>.
        Next, add your first client and we&apos;ll start collecting.
      </p>

      <GlassCard className="mt-8 p-6 text-left">
        <p className="label-mono text-muted-foreground/70">Invite your team</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Share this code — teammates enter it at{" "}
          <span className="font-mono text-foreground">/join</span>:
        </p>
        <p className="mt-3 rounded-xl border border-border bg-popover/50 px-4 py-3 text-center font-mono text-lg tracking-[0.25em] text-brand-teal">
          {workspace.inviteCode}
        </p>
      </GlassCard>

      <div className="mt-8 flex justify-center gap-3">
        <Button
          asChild
          className="rounded-full bg-brand-teal text-primary-foreground hover:bg-brand-teal/90"
        >
          <Link
            href={hasClients ? `/p/${workspace.id}` : `/p/${workspace.id}/start`}
          >
            {hasClients ? "Open Platina" : "Add your first client"}
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="rounded-full border-border bg-transparent text-foreground hover:bg-accent hover:text-foreground"
        >
          <Link href={`/w/${workspace.id}/kb`}>Open the InstaMedia workspace</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="rounded-full border-border bg-transparent text-foreground hover:bg-accent hover:text-foreground"
        >
          <Link href="/workspace/setup">Add another workspace</Link>
        </Button>
      </div>
    </div>
  );
}
