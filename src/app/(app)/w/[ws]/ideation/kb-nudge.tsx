"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, RefreshCw } from "lucide-react";
import { useWorkspaceRealtime } from "@/app/(app)/w/[ws]/use-workspace-realtime";
import { Button } from "@/components/ui/button";

export function KbNudge({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [hasNewKnowledge, setHasNewKnowledge] = useState(false);

  useWorkspaceRealtime({
    workspaceId,
    scopes: ["kb"],
    onSignal: () => {
      setHasNewKnowledge(true);
    },
  });

  if (!hasNewKnowledge) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-teal/40 bg-brand-teal/10 p-3.5 text-xs text-foreground backdrop-blur animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-brand-teal shrink-0" />
        <span>
          <strong className="text-brand-teal">Fresh Knowledge Indexed:</strong> New brand sources or web content were just added to the Knowledge Base.
        </span>
      </div>

      <Button
        type="button"
        size="sm"
        onClick={() => {
          setHasNewKnowledge(false);
          router.refresh();
        }}
        className="h-7 gap-1.5 bg-brand-teal text-xs font-semibold text-primary-foreground hover:bg-brand-teal/90"
      >
        <RefreshCw className="size-3" /> Refresh Ideation Context
      </Button>
    </div>
  );
}
