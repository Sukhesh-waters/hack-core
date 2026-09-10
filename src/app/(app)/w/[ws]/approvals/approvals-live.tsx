"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceRealtime } from "../use-workspace-realtime";
import { LivePulse } from "@/components/live-pulse";

const POLL_MS = 30_000;

export function ApprovalsLive({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [lastSignalAt, setLastSignalAt] = useState<number | null>(null);

  useWorkspaceRealtime({
    workspaceId,
    // "approvals" covers content approve/schedule (this page's own actions);
    // gate decisions are handled through the SOP run engine and broadcast
    // under "sop" instead — both land on this page's Process gates section.
    scopes: ["approvals", "sop"],
    onSignal: () => {
      setLastSignalAt(Date.now());
      router.refresh();
    },
  });

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return <LivePulse lastSignalAt={lastSignalAt} />;
}
