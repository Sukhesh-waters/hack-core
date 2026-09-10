"use client";

import { useWorkspaceRealtime } from "../use-workspace-realtime";
import type { HubScope } from "@/lib/realtime";

const HUB_SCOPES: HubScope[] = [
  "messages",
  "approvals",
  "tasks",
  "reminders",
  "plan",
];

/**
 * Subscribes to the workspace hub channel for Hub-specific scopes.
 * Preserves the exact signature for Team Hub components.
 */
export function useHubRealtime({
  workspaceId,
  userId,
  onSignal,
}: {
  workspaceId: string;
  userId: string;
  onSignal: (scope: HubScope) => void;
}) {
  return useWorkspaceRealtime({
    workspaceId,
    userId,
    scopes: HUB_SCOPES,
    onSignal,
  });
}

