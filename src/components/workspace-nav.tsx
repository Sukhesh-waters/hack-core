"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  Cable,
  CalendarDays,
  CheckCheck,
  Dna,
  FileText,
  FolderOpen,
  Gauge,
  Kanban,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Megaphone,
  MessagesSquare,
  PenTool,
  Radar,
  Scale,
  Rocket,
  Sliders,
  Table2,
  TicketCheck,
  TrendingUp,
  Users,
  Inbox,
  Circle,
  GitBranch,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { NAV_GROUPS, NAV_SECTIONS, getChildSections, isPrimarySection } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useAppShell } from "@/components/app-shell-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Keyed by nav slug. Every NAV_SECTIONS slug needs an entry — see the
 * fallback at the call site: a missing one used to render `undefined` as a
 * component, which blanks EVERY page in the workspace, not just the new one.
 */
const ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  "my-work": Inbox,
  sprint: Rocket,
  workflows: GitBranch,
  hub: MessagesSquare,
  sop: Workflow,
  plan: ListChecks,
  production: Kanban,
  tickets: TicketCheck,
  docs: FileText,
  approvals: CheckCheck,
  calendar: CalendarDays,
  "brand-gene": Dna,
  assets: FolderOpen,
  ideation: Lightbulb,
  studio: PenTool,
  kb: BookOpenText,
  decisions: Scale,
  drift: Radar,
  reports: TrendingUp,
  ads: Megaphone,
  cockpit: Gauge,
  accounts: Cable,
  rules: Sliders,
  automations: Zap,
  clients: Users,
  fields: Table2,
};

/** Renders workspace links with collapsible icon-only tooltips. */
/**
 * Pinned at the foot of the sidebar, always in view (owner request C8):
 * the competitor portal and pattern layer. A plain link — the portal lives in
 * Platina, which reads competitors' public pages; InstaMedia's knowledge base
 * keeps only the client's own.
 */
export const COMPETITORS_BUTTON_LABEL = "Competitors analysis – pattern layer";

function CompetitorsButton({ href, collapsed }: { href: string; collapsed: boolean }) {
  const link = (
    <Link
      href={href}
      data-testid="competitors-button"
      // Remember this page, so Back on the competitors page returns here.
      onClick={() => {
        try {
          // Same key as BackButton (components/platina/back-button.tsx).
          window.sessionStorage.setItem("platina:back", window.location.pathname + window.location.search);
        } catch {
          // Storage blocked: Back falls back to the workspace home.
        }
      }}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15",
        collapsed && "justify-center px-2",
      )}
    >
      <Radar className="h-4 w-4 shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">{COMPETITORS_BUTTON_LABEL}</span> : <span className="leading-tight">{COMPETITORS_BUTTON_LABEL}</span>}
    </Link>
  );
  return (
    <div className="sticky bottom-0 mt-4 border-t border-border/60 bg-card/95 pb-1 pt-3 backdrop-blur">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{COMPETITORS_BUTTON_LABEL}</TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </div>
  );
}

export function WorkspaceNav() {
  const pathname = usePathname();
  const { isCollapsed } = useAppShell();
  const match = pathname.match(/^\/w\/([^/]+)/);
  if (!match) return null;

  const base = `/w/${match[1]}`;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-4">
        {NAV_GROUPS.map((group) => {
          const groupSections = NAV_SECTIONS.filter((s) => s.group === group);
          const primarySections = groupSections.filter(isPrimarySection);

          return (
            <div key={group} className="space-y-1">
              {!isCollapsed ? (
                <p className="label-mono px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {group}
                </p>
              ) : (
                <div className="my-2 h-[1px] bg-border/40" />
              )}

              {primarySections.map((s) => {
                const Icon = ICONS[s.slug] ?? Circle;
                const href = `${base}/${s.slug}`;
                const isExactActive = pathname === href || pathname.startsWith(`${href}/`);
                const children = getChildSections(s.slug);
                const hasActiveChild = children.some(
                  (c) => pathname === `${base}/${c.slug}` || pathname.startsWith(`${base}/${c.slug}/`),
                );
                const isActive = isExactActive && !hasActiveChild;
                const isExpanded = isExactActive || hasActiveChild;

                const linkContent = (
                  <Link
                    key={s.slug}
                    href={href}
                    className={cn(
                      "flex items-center rounded-xl text-sm transition-all relative group",
                      isCollapsed
                        ? "justify-center p-2.5 hover:bg-accent hover:text-foreground"
                        : "gap-3 px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground",
                      isActive
                        ? isCollapsed
                          ? "bg-brand-teal/15 text-brand-teal font-medium"
                          : "bg-accent text-foreground font-medium shadow-sm"
                        : hasActiveChild && !isCollapsed
                        ? "text-foreground font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform group-hover:scale-110",
                        isActive || hasActiveChild
                          ? "text-brand-teal"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                      aria-hidden
                    />

                    {!isCollapsed && (
                      <>
                        <span className="truncate">{s.label}</span>
                        {s.status === "pending" && (
                          <span className="label-mono ml-auto text-[9px] text-muted-foreground/50">
                            soon
                          </span>
                        )}
                        {children.length > 0 && (
                          <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">
                            {children.length}
                          </span>
                        )}
                      </>
                    )}

                    {isActive && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-r-full bg-brand-teal"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );

                if (isCollapsed) {
                  return (
                    <Tooltip key={s.slug}>
                      <TooltipTrigger asChild>
                        {linkContent}
                      </TooltipTrigger>
                      <TooltipContent side="right" className="flex flex-col gap-0.5 font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>{s.label}</span>
                          <span className="text-[10px] text-muted-foreground">({group})</span>
                        </div>
                        {children.length > 0 && (
                          <span className="text-[10px] text-muted-foreground/80">
                            Includes: {children.map((c) => c.label).join(", ")}
                          </span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <div key={s.slug} className="space-y-0.5">
                    {linkContent}
                    {/* Render nested child sections when parent or child is active */}
                    {isExpanded && children.length > 0 && (
                      <div className="ml-4 pl-2 border-l border-border/40 space-y-0.5 my-1">
                        {children.map((child) => {
                          const ChildIcon = ICONS[child.slug] ?? Circle;
                          const childHref = `${base}/${child.slug}`;
                          const isChildActive =
                            pathname === childHref || pathname.startsWith(`${childHref}/`);

                          return (
                            <Link
                              key={child.slug}
                              href={childHref}
                              className={cn(
                                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all relative group",
                                isChildActive
                                  ? "bg-brand-teal/15 text-brand-teal font-medium"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                            >
                              <ChildIcon
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-110",
                                  isChildActive
                                    ? "text-brand-teal"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                                aria-hidden
                              />
                              <span className="truncate">{child.label}</span>
                              {isChildActive && (
                                <span
                                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-r-full bg-brand-teal"
                                  aria-hidden="true"
                                />
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <CompetitorsButton href={`/p/${match[1]}/competitors`} collapsed={isCollapsed} />
    </TooltipProvider>
  );
}
