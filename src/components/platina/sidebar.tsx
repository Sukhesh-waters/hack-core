"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLATINA_NAV } from "@/lib/platina/nav";
import { cn } from "@/lib/utils";

/**
 * Platina shell sidebar — the six outcome-oriented destinations. No link to
 * InstaMedia: the products are separate surfaces by constitution.
 */
export function PlatinaSidebar({
  workspaceId,
  workspaceName,
  scope,
}: {
  workspaceId: string;
  workspaceName: string;
  /** "Division · Region" once the workspace profile is set (R3). */
  scope?: string | null;
}) {
  const pathname = usePathname();
  const base = `/p/${workspaceId}`;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-5 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
          Platina AI OS
        </p>
        <p className="mt-1 truncate font-display text-lg font-medium">
          {workspaceName}
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {scope ?? "Campaign planning"}
        </p>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
        {PLATINA_NAV.map((section) => {
          const href = `${base}/${section.slug}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={section.slug}
              href={href}
              className={cn(
                "rounded-md border-l-2 px-3 py-2 text-sm",
                active
                  ? "border-primary bg-accent font-medium text-accent-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Plans learn from the results you record
        </p>
      </div>
    </aside>
  );
}
