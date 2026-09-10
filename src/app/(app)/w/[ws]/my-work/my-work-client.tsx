"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspaceRealtime } from "@/app/(app)/w/[ws]/use-workspace-realtime";
import type { MyWorkItem } from "@/db/queries/my-work";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { Layers, FileText, Ticket, Clock, AlertTriangle, ShieldCheck, ChevronRight } from "lucide-react";

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function dueLabel(dueAt: Date | null, now: Date) {
  if (!dueAt) return { text: "No date", tone: "text-muted-foreground/50" };
  const due = new Date(dueAt);
  const days = Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) {
    return { text: `${Math.abs(days)}d overdue`, tone: "text-destructive font-medium" };
  }
  if (days === 0) return { text: "Due today", tone: "text-amber-300 font-medium" };
  if (days === 1) return { text: "Due tomorrow", tone: "text-amber-300" };
  return { text: `Due in ${days}d`, tone: "text-muted-foreground/70" };
}

const KIND_META = {
  content: {
    label: "Draft",
    icon: FileText,
    badgeClass: "border-brand-purple/40 text-brand-purple bg-brand-purple/5",
  },
  ticket: {
    label: "Ticket",
    icon: Ticket,
    badgeClass: "border-brand-teal/40 text-brand-teal bg-brand-teal/5",
  },
  sop_step: {
    label: "SOP Step",
    icon: Layers,
    badgeClass: "border-amber-400/40 text-amber-300 bg-amber-400/5",
  },
};

export function MyWorkClient({
  workspaceId,
  userId,
  initialItems,
}: {
  workspaceId: string;
  userId: string;
  initialItems: MyWorkItem[];
}) {
  const router = useRouter();

  useWorkspaceRealtime({
    workspaceId,
    userId,
    scopes: ["my-work", "sop", "tasks", "workflow"],
    onSignal: () => {
      router.refresh();
    },
  });

  const now = new Date();

  return (
    <div className="space-y-4">
      {initialItems.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-card border border-border">
          <p className="text-sm text-muted-foreground">
            No active drafts, tickets, or SOP steps are currently assigned to you.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {initialItems.map((item) => {
            const due = dueLabel(item.dueAt, now);
            const meta = KIND_META[item.kind] ?? KIND_META.content;
            const Icon = meta.icon;

            return (
              <li key={`${item.kind}-${item.id}`}>
                <Link href={item.href} className="block group">
                  <GlassCard className="p-4.5 transition hover:border-brand-teal/50 hover:bg-muted/40">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium flex items-center gap-1 border ${meta.badgeClass}`}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{meta.label}</span>
                          </span>
                          {item.meta?.runName && (
                            <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                              Run: {item.meta.runName}
                            </span>
                          )}
                          {item.clientName && (
                            <span className="text-xs text-muted-foreground font-mono">
                              Client: {item.clientName}
                            </span>
                          )}
                        </div>

                        <p className="font-medium text-foreground group-hover:text-brand-teal transition-colors truncate">
                          {item.title}
                        </p>

                        {item.meta?.rejectionReason && (
                          <div className="flex items-start gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 rounded-md">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
                            <span className="line-clamp-2">
                              <span className="font-semibold text-rose-300">Feedback:</span> {item.meta.rejectionReason}
                            </span>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono">
                          {item.meta?.gate && item.meta.gate !== "none" && (
                            <span className="flex items-center gap-1 text-amber-300">
                              <ShieldCheck className="w-3 h-3" />
                              <span>Gate: {item.meta.gate}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <Badge
                          variant="outline"
                          className="border-border text-xs text-muted-foreground uppercase font-mono"
                        >
                          {labelize(item.status)}
                        </Badge>
                        <span className={`text-xs font-mono flex items-center gap-1 ${due.tone}`}>
                          {due.text.includes("overdue") && (
                            <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                          )}
                          {!due.text.includes("overdue") && (
                            <Clock className="w-3 h-3 text-muted-foreground" />
                          )}
                          <span>{due.text}</span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </GlassCard>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
