import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getWorkspaceById } from "@/db/queries/workspaces";
import { PlatinaHeader } from "@/components/platina/header";
import { PlatinaSidebar } from "@/components/platina/sidebar";

export default async function PlatinaWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { ws: string };
}) {
  const user = await requireUser();
  try {
    await requireMembership(params.ws, user.id);
  } catch {
    notFound();
  }
  const workspace = await getWorkspaceById(params.ws);
  if (!workspace) notFound();

  return (
    <div className="platina-shell flex h-screen bg-background text-foreground">
      <PlatinaSidebar workspaceId={params.ws} workspaceName={workspace.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <PlatinaHeader workspaceId={params.ws} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
