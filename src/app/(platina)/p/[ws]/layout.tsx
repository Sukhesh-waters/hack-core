import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getWorkspaceProfile } from "@/db/queries/platina";
import { getWorkspaceById } from "@/db/queries/workspaces";
import { PlatinaHeader } from "@/components/platina/header";
import { PlatinaSidebar } from "@/components/platina/sidebar";
import { platinaTopicToken } from "@/lib/platina/realtime-server";

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
  // Independent lookups: run them together instead of paying two sequential
  // round trips on every Platina page transition.
  const [workspace, profile] = await Promise.all([
    getWorkspaceById(params.ws),
    getWorkspaceProfile(params.ws),
  ]);
  if (!workspace) notFound();

  // Membership is checked above, so this is the safe place to mint the
  // opaque Realtime topic token. Null when the secret is absent — the
  // client visibly degrades to polling.
  const topicToken = platinaTopicToken(params.ws);
  const scope =
    profile?.division || profile?.region
      ? [profile.division, profile.region].filter(Boolean).join(" · ")
      : null;

  return (
    <div className="platina-shell flex h-screen bg-background text-foreground">
      <PlatinaSidebar
        workspaceId={params.ws}
        workspaceName={workspace.name}
        scope={scope}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <PlatinaHeader workspaceId={params.ws} topicToken={topicToken} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
