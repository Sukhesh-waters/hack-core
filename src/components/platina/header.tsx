"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLATINA_NAV } from "@/lib/platina/nav";
import { PlatinaLiveStatus } from "@/components/platina/live-status";

/**
 * Executive header: breadcrumbs over the six destinations plus the live
 * transport pill. Deliberately no search box — it arrives with a real
 * backend, and an unwired control would violate the honesty rule.
 */
export function PlatinaHeader({
  workspaceId,
  topicToken,
}: {
  workspaceId: string;
  topicToken: string | null;
}) {
  const pathname = usePathname();
  const base = `/p/${workspaceId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const segments = rest.split("/").filter(Boolean);

  const crumbs = segments.map((seg, i) => {
    const nav = PLATINA_NAV.find((s) => s.slug === seg);
    const label = nav?.label ?? seg.charAt(0).toUpperCase() + seg.slice(1);
    return { href: `${base}/${segments.slice(0, i + 1).join("/")}`, label };
  });

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link
          href={base}
          className="font-medium text-muted-foreground hover:text-foreground"
        >
          Cockpit
        </Link>
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-2">
            <span className="text-muted-foreground">/</span>
            {i === crumbs.length - 1 ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className="text-muted-foreground hover:text-foreground"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>
      <PlatinaLiveStatus topicToken={topicToken} />
    </header>
  );
}
