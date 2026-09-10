import Link from "next/link";
import { ArrowRight, Building2, DoorOpen } from "lucide-react";
import { requireUser } from "@/auth";
import { isDbConfigured } from "@/db";
import { listWorkspacesForUser } from "@/db/queries/memberships";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Hub" };
export const dynamic = "force-dynamic";

export default async function HubPage() {
  const user = await requireUser();

  let workspaces: Awaited<ReturnType<typeof listWorkspacesForUser>> = [];
  let dbReady = isDbConfigured();
  if (dbReady) {
    try {
      workspaces = await listWorkspacesForUser(user.id);
    } catch {
      dbReady = false;
    }
  }

  return (
    <div>
      <p className="label-mono text-brand-teal">Hub</p>
      <h1 className="mt-2 font-display text-4xl">
        Where are you working today?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Pick a workspace, claim a new organization, or join a team.
      </p>

      {!dbReady ? (
        <GlassCard className="mt-8 border-brand-amber/30 p-6">
          <p className="label-mono text-brand-amber">Setup required</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The database isn&apos;t reachable. Set{" "}
            <code className="font-mono text-brand-amber">DATABASE_URL</code> in{" "}
            <code className="font-mono">.env.local</code> and run{" "}
            <code className="font-mono">npm run db:migrate</code>.
          </p>
        </GlassCard>
      ) : null}

      {workspaces.length > 0 ? (
        <div className="mt-8 space-y-3">
          <p className="label-mono text-muted-foreground/70">Your workspaces</p>
          {workspaces.map(({ workspace, org, membership }) => (
            <GlassCard
              key={workspace.id}
              className="flex items-center justify-between p-5"
            >
              <div>
                <p className="font-display text-xl">{workspace.name}</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {org.name} ·{" "}
                  <span className="font-mono">{workspace.slug}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge className="label-mono border-0 bg-brand-purple/20 text-[10px] text-brand-purple">
                  {membership.role}
                </Badge>
                <Button
                  asChild
                  size="sm"
                  className="rounded-full bg-brand-teal text-foreground hover:bg-brand-teal/90"
                >
                  <Link href={`/w/${workspace.id}/kb`}>
                    Enter <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link href="/org/claim" className="group">
          <GlassCard className="h-full p-6 transition group-hover:border-brand-teal/40">
            <Building2 className="h-6 w-6 text-brand-teal" aria-hidden />
            <h2 className="mt-4 font-display text-2xl">Claim an org</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start fresh: create your agency&apos;s organization and first
              workspace.
            </p>
          </GlassCard>
        </Link>
        <Link href="/join" className="group">
          <GlassCard className="h-full p-6 transition group-hover:border-brand-purple/40">
            <DoorOpen className="h-6 w-6 text-brand-purple" aria-hidden />
            <h2 className="mt-4 font-display text-2xl">Join a workspace</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Have an invite code or workspace slug? Join your team here.
            </p>
          </GlassCard>
        </Link>
      </div>
    </div>
  );
}
