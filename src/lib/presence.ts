export type WorkspaceMemberOption = {
  userId: string;
  name: string | null;
  email: string;
};

export type OnlineMember = {
  id: string;
  label: string;
};

/**
 * Pure mapping from the realtime hook's raw online-id set to something a
 * shell-level widget can render — resolves each id to a display name (or
 * email if unnamed), drops ids with no matching member (a stale presence
 * entry for someone who left the workspace), and sorts for a stable render
 * order across ticks instead of flickering with Set iteration order.
 */
export function resolveOnlineMembers(
  onlineIds: Set<string>,
  members: WorkspaceMemberOption[],
): OnlineMember[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const resolved: OnlineMember[] = [];
  for (const id of onlineIds) {
    const member = byId.get(id);
    if (!member) continue;
    resolved.push({ id, label: member.name ?? member.email });
  }
  return resolved.sort((a, b) => a.label.localeCompare(b.label));
}
