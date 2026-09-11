"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLATINA_NAV, PLATINA_NAV_GROUPS } from "@/lib/platina/nav";
import { cn } from "@/lib/utils";

export function PlatinaSidebar({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const base = `/p/${workspaceId}`;

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-6 border-r border-border bg-card px-3 py-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Platina AI OS
        </p>
        <p className="font-display text-lg">Waters</p>
      </div>
      {PLATINA_NAV_GROUPS.map((group) => (
        <div key={group}>
          <p className="mb-1 px-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {group}
          </p>
          <nav className="flex flex-col gap-0.5">
            {PLATINA_NAV.filter((s) => s.group === group).map((section) => {
              const href = section.slug ? `${base}/${section.slug}` : base;
              const active =
                section.slug === ""
                  ? pathname === base
                  : pathname.startsWith(href);
              return (
                <Link
                  key={section.slug || "cockpit"}
                  href={href}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm",
                    active
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {section.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
      <Link
        href={`/w/${workspaceId}/overview`}
        className="mt-auto px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Open InstaMedia
      </Link>
    </aside>
  );
}
