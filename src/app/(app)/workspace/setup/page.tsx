import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { orgs } from "@/db/schema";
import { GlassCard } from "@/components/glass-card";
import { WorkspaceSetupForm } from "./setup-form";

export const metadata = { title: "Workspace setup" };
export const dynamic = "force-dynamic";

export default async function WorkspaceSetupPage({
  searchParams,
}: {
  searchParams: { org?: string };
}) {
  const user = await requireUser();

  let org: { id: string; name: string } | null = null;
  try {
    if (searchParams.org) {
      const rows = await db
        .select({ id: orgs.id, name: orgs.name, ownerUserId: orgs.ownerUserId })
        .from(orgs)
        .where(eq(orgs.id, searchParams.org))
        .limit(1);
      if (rows[0]?.ownerUserId === user.id) org = rows[0];
    }
    if (!org) {
      const owned = await db
        .select({ id: orgs.id, name: orgs.name })
        .from(orgs)
        .where(eq(orgs.ownerUserId, user.id))
        .limit(1);
      org = owned[0] ?? null;
    }
  } catch {
    org = null;
  }

  if (!org) redirect("/org/claim");

  return (
    <div className="mx-auto max-w-lg">
      <p className="label-mono text-brand-purple">Step 2 of 2</p>
      <h1 className="mt-2 font-display text-4xl">Set up a workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Creating in <span className="text-foreground">{org.name}</span>. Every
        client&apos;s data stays isolated to its workspace.
      </p>
      <GlassCard className="mt-8 p-7">
        <WorkspaceSetupForm orgId={org.id} />
      </GlassCard>
    </div>
  );
}
