"use client";

import { useWorkspaceRealtime } from "./use-workspace-realtime";
import { resolveOnlineMembers, type WorkspaceMemberOption } from "@/lib/presence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * Shell-level presence — previously only visible inside Hub's own canvas
 * (UC-OPS-21). Mounted once in the workspace layout so "who's online" is
 * visible on all 25 sections, not just one (2026-08-17 audit finding).
 * Positioned bottom-20 LEFT deliberately — NotificationBell and
 * AskPlatinaLazy both stack on the right (see notification-bell.tsx's
 * own comment on that collision), this avoids it entirely.
 */
export function WorkspacePresence({
  workspaceId,
  userId,
  members,
}: {
  workspaceId: string;
  userId: string;
  members: WorkspaceMemberOption[];
}) {
  const { onlineIds } = useWorkspaceRealtime({
    workspaceId,
    userId,
    onSignal: () => {},
  });
  const online = resolveOnlineMembers(onlineIds, members);
  if (online.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-6 z-40 flex items-center gap-2 rounded-full border border-border bg-popover/90 px-3 py-1.5 shadow-lg backdrop-blur">
      <div className="flex -space-x-2">
        {online.slice(0, 5).map((m) => (
          <Avatar key={m.id} className="size-6 border border-popover">
            <AvatarFallback className="bg-brand-teal/30 text-[10px] text-foreground">
              {m.label.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {online.length} online
      </span>
    </div>
  );
}
