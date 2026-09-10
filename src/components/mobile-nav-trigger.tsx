"use client";

import { Menu } from "lucide-react";
import { useAppShell } from "@/components/app-shell-provider";
import { Button } from "@/components/ui/button";

export function MobileNavTrigger() {
  const { toggleMobile } = useAppShell();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleMobile}
      className="h-8 w-8 rounded-xl md:hidden text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label="Open navigation menu"
    >
      <Menu className="h-4 w-4" />
    </Button>
  );
}
