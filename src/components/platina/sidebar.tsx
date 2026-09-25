"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLATINA_NAV } from "@/lib/platina/nav";
import { cn } from "@/lib/utils";

/**
 * Platina shell sidebar — the destinations, grouped by the loop (lib/platina/nav.ts). No link to
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
          {scope ?? "Waters executive surface"}
        </p>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4" aria-label="Platina">
        {PLATINA_NAV.map((section, i) => {
          const href = section.slug ? `${base}/${section.slug}` : base;
          // A heading above the first entry of each group (C7.9: the loop).
          const heading =
            section.group && section.group !== PLATINA_NAV[i - 1]?.group ? (
              <p
                key={`group-${section.group}`}
                className="mt-4 px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground first:mt-0"
              >
                {section.group}
              </p>
            ) : null;
          const active =
            section.slug === ""
              ? pathname === base
              : pathname.startsWith(href);
          return [
            heading,
            <Link
              key={section.slug || "cockpit"}
              href={href}
              className={cn(
                "rounded-md border-l-2 px-3 py-2 text-sm",
                active
                  ? "border-primary bg-accent font-medium text-accent-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {section.label}
            </Link>,
          ];
        })}
      </nav>
      <div className="border-t border-border px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Read-only for Waters systems
        </p>
      </div>
    </aside>
  );
}
