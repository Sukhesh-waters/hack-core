"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Where the InstaMedia sidebar button was clicked from (set by workspace-nav). */
export const BACK_KEY = "platina:back";

/**
 * "Back" to the page the person came from: the InstaMedia page whose sidebar
 * button opened this one. Remembered for the tab, so it survives switching
 * tabs and "Read it now" reloads. Only a path inside this workspace counts;
 * otherwise (opened directly) it goes to `fallback`.
 */
export function BackButton({ ws, fallback, label = "Back" }: { ws: string; fallback: string; label?: string }) {
  const [href, setHref] = useState(fallback);
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(BACK_KEY);
      if (saved && (saved.startsWith(`/w/${ws}`) || saved.startsWith(`/p/${ws}`)) && !saved.includes("//")) setHref(saved);
    } catch {
      // Storage blocked: the fallback still works.
    }
  }, [ws]);
  return (
    <Link
      href={href}
      data-testid="back-button"
      className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Link>
  );
}
