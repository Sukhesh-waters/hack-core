"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceRealtime } from "@/app/(app)/w/[ws]/use-workspace-realtime";
import {
  fetchNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationItem,
} from "./notification-actions";

/**
 * Subscribes to the same workspace Realtime channel every live surface
 * uses, so notifications land sub-second instead of up to 60s stale
 * (2026-08-17 audit: this bell ran a second, disconnected poll-only
 * system while every other surface used the real channel). The 60s poll
 * stays as the degradation-ladder fallback for a missed broadcast — never
 * removed, just no longer the primary path.
 */
const POLL_MS = 60_000;

/** Where a notification deep-links, by subject type. */
function hrefFor(workspaceId: string, item: NotificationItem): string {
  switch (item.subjectType) {
    case "content":
      return `/w/${workspaceId}/studio/${item.subjectId}`;
    case "ticket":
      return `/w/${workspaceId}/tickets/${item.subjectId}`;
    case "idea":
      return `/w/${workspaceId}/plan`;
    case "sop_run_step":
      return `/w/${workspaceId}/my-work`;
    case "client":
      return `/w/${workspaceId}/clients/${item.subjectId}`;
    default:
      return `/w/${workspaceId}/overview`;
  }
}

export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const feed = await fetchNotificationsAction(workspaceId);
      setUnread(feed.unread);
      setItems(feed.items);
    } catch {
      // A failed poll is not worth interrupting the user over; the next
      // tick retries. Silence here is deliberate, not an oversight.
    }
  }, [workspaceId]);

  useWorkspaceRealtime({
    workspaceId,
    onSignal: () => void refresh(),
  });

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Close on outside click and on Escape — a dropdown that traps the user
  // is worse than no dropdown.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openItem(item: NotificationItem) {
    setOpen(false);
    if (!item.read) {
      setUnread((n) => Math.max(0, n - 1));
      setItems((cur) =>
        cur.map((i) => (i.id === item.id ? { ...i, read: true } : i)),
      );
      await markNotificationReadAction(workspaceId, item.id);
    }
    router.push(hrefFor(workspaceId, item));
  }

  async function markAll() {
    setUnread(0);
    setItems((cur) => cur.map((i) => ({ ...i, read: true })));
    await markAllNotificationsReadAction(workspaceId);
  }

  // Stacked ABOVE the Ask Platina launcher rather than beside it. That
  // button is 132px wide at z-50, so any side-by-side offset both guesses its
  // width and loses the stacking contest — the bell was unclickable.
  return (
    <div ref={panelRef} className="fixed bottom-20 right-6 z-40">
      <button
        type="button"
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-11 items-center justify-center rounded-full border border-border bg-popover/90 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-brand-teal px-1 text-xs font-medium text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute bottom-14 right-0 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm text-muted-foreground">Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-xs text-muted-foreground/70 hover:text-foreground"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/70">
              Nothing needs you right now.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted",
                      item.read ? "text-muted-foreground/70" : "text-foreground",
                    )}
                  >
                    <span className="text-sm">{item.body}</span>
                    <span className="text-xs text-muted-foreground/50">
                      {new Date(item.createdAtIso).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
