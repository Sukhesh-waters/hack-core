"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { WorkspaceNav } from "@/components/workspace-nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppShell } from "@/components/app-shell-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { signOutAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

const activeItems = [
  { label: "Hub", href: "/hub", icon: LayoutGrid },
  { label: "Join a workspace", href: "/join", icon: Compass },
];

export function AppSidebar({
  user,
}: {
  user: { name?: string | null; email?: string | null; image?: string | null };
}) {
  const pathname = usePathname();
  const { isCollapsed, toggleCollapsed, isMobileOpen, setIsMobileOpen } = useAppShell();

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Top Header with Brand and Burger Toggle */}
      <div
        className={cn(
          "flex items-center pb-4 transition-all",
          isCollapsed
            ? "flex-col gap-3 justify-center items-center"
            : "justify-between px-1",
        )}
      >
        <BrandMark href="/hub" compact={isCollapsed} className="text-foreground" />

        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCollapsed}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isCollapsed && "mt-1",
                )}
                aria-label={isCollapsed ? "Expand sidebar (Cmd+B)" : "Collapse sidebar (Cmd+B)"}
              >
                {isCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4 text-brand-teal" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side={isCollapsed ? "right" : "bottom"}>
              <span className="text-xs font-medium">
                {isCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Navigation List */}
      <nav className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pr-1">
        <TooltipProvider delayDuration={100}>
          {activeItems.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || (href !== "/hub" && pathname.startsWith(href));
            const linkContent = (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center rounded-xl text-sm transition-all group",
                  isCollapsed
                    ? "justify-center p-2.5 hover:bg-accent hover:text-foreground"
                    : "gap-3 px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground",
                  isActive
                    ? isCollapsed
                      ? "bg-brand-teal/15 text-brand-teal font-medium"
                      : "bg-accent text-foreground font-medium shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform group-hover:scale-110",
                    isActive ? "text-brand-teal" : "text-brand-teal/70 group-hover:text-brand-teal",
                  )}
                  aria-hidden
                />
                {!isCollapsed && <span className="truncate">{label}</span>}
              </Link>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">
                    <span>{label}</span>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </TooltipProvider>

        <div className="my-2 h-[1px] bg-border/40" />

        {/* Workspace specific nav links */}
        <WorkspaceNav />
      </nav>

      {/* User Footer */}
      <div
        className={cn(
          "mt-4 rounded-2xl border border-border bg-muted/60 backdrop-blur-md transition-all",
          isCollapsed
            ? "flex flex-col items-center gap-2 p-2"
            : "flex items-center gap-2.5 p-2.5",
        )}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-8 w-8 shrink-0 cursor-pointer border border-border/80">
                <AvatarImage src={user.image ?? undefined} alt="" />
                <AvatarFallback className="bg-brand-purple/20 text-xs font-semibold text-foreground">
                  {(user.name ?? user.email ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <div className="text-xs">
                  <p className="font-semibold">{user.name ?? user.email}</p>
                  {user.email && <p className="text-muted-foreground">{user.email}</p>}
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">
              {user.name ?? user.email}
            </p>
            {user.name && user.email ? (
              <p className="truncate text-[11px] text-muted-foreground/70">{user.email}</p>
            ) : null}
          </div>
        )}

        <div className={cn("flex items-center gap-1", isCollapsed && "flex-col")}>
          <ThemeToggle />

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => signOutAction()}
                  className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? "right" : "top"}>
                <span>Sign out</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar with Animated Width */}
      <aside
        className={cn(
          "hidden md:flex h-full shrink-0 flex-col rounded-2xl border border-border bg-popover/90 p-4 shadow-xl backdrop-blur-xl transition-all duration-300 ease-in-out",
          isCollapsed ? "w-[72px]" : "w-64",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Slide-over Drawer Backdrop */}
      {isMobileOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close menu"
          onClick={() => setIsMobileOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsMobileOpen(false);
            }
          }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden animate-in fade-in"
        />
      )}

      {/* Mobile Drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-popover p-5 shadow-2xl transition-transform duration-300 ease-in-out md:hidden",
          isMobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={() => setIsMobileOpen(false)}
          className="absolute right-4 top-4 rounded-xl p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebarContent}
      </aside>
    </>
  );
}
