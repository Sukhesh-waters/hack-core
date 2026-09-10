"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isUndoable, type UndoToken } from "@/lib/undo";
import { RotateCcw, X } from "lucide-react";

export function UndoToast({
  token,
  onUndo,
  onDismiss,
}: {
  token: UndoToken | null;
  onUndo: (token: UndoToken) => void;
  onDismiss?: () => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!token || !isUndoable(token)) {
      setActive(false);
      return;
    }
    setActive(true);

    const interval = setInterval(() => {
      if (!isUndoable(token)) {
        setActive(false);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [token]);

  if (!active || !token) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm font-medium text-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <span>Action completed</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          onUndo(token);
          setActive(false);
        }}
        className="flex items-center gap-1.5 border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Undo
      </Button>
      <button
        type="button"
        onClick={() => {
          setActive(false);
          onDismiss?.();
        }}
        className="ml-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss undo notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
