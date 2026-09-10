"use client";

import { useRouter } from "next/navigation";

export function ClientSelect({
  workspaceId,
  clients,
  activeId,
  tab,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
  activeId: string;
  tab: string;
}) {
  const router = useRouter();
  return (
    <select
      value={activeId}
      onChange={(e) =>
        router.push(
          `/w/${workspaceId}/brand-gene?client=${e.target.value}&tab=${tab}`,
        )
      }
      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {clients.map((client) => (
        <option key={client.id} value={client.id} className="bg-popover">
          {client.name}
        </option>
      ))}
    </select>
  );
}
