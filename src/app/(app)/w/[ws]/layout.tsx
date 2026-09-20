import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { AskPlatinaLazy } from "@/components/ask-platina-lazy";
import { NotificationBell } from "@/components/notification-bell";
import { DirectChatDrawer } from "@/components/direct-chat-drawer";
import { ShellSpendTicker } from "@/components/shell-spend-ticker";
import {
  listWorkspaceMembers,
  requireMembership,
} from "@/db/queries/memberships";
import { WorkspacePresence } from "./workspace-presence";

export default async function WorkspaceLayout({
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
  const members = await listWorkspaceMembers(params.ws);
  return (
    <>
      <div className="fixed top-3 right-20 z-40">
        <ShellSpendTicker workspaceId={params.ws} />
      </div>
      {children}
      <NotificationBell workspaceId={params.ws} />
      <DirectChatDrawer
        workspaceId={params.ws}
        currentUserId={user.id}
        members={members}
      />
      <WorkspacePresence
        workspaceId={params.ws}
        userId={user.id}
        members={members}
      />
      <AskPlatinaLazy workspaceId={params.ws} />
    </>
  );
}
