"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      size="sm"
      className="bg-brand-teal text-primary-foreground hover:bg-brand-teal/90"
    >
      Print / Save as PDF
    </Button>
  );
}
