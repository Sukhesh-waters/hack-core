import Link from "next/link";
import type { DegradationNotice } from "@/lib/platina/degradation";
import { cn } from "@/lib/utils";

/**
 * Renders the degradation ladder: what is paused, stale or broken, and where
 * to go about it. Renders nothing when everything is healthy.
 */
export function DegradationBanner({ notices }: { notices: DegradationNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <ul className="mb-6 space-y-2" aria-label="Collection status">
      {notices.map((n) => (
        <li
          key={n.id}
          className={cn(
            "rounded-md border p-3 text-sm",
            n.tone === "error"
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-brand-amber/40 bg-brand-amber/10 text-foreground",
          )}
        >
          {n.text}
          {n.href ? (
            <>
              {" "}
              <Link href={n.href} className="font-medium underline underline-offset-4">
                {n.hrefLabel ?? "Details"}
              </Link>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
