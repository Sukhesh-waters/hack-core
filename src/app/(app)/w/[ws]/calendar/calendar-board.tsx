"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/glass-card";
import { cn } from "@/lib/utils";
import type { PublishChecklistItem } from "@/lib/calendar";
import { clientColor } from "@/lib/colors";
import { AddSlotForm, type ClientOption } from "./add-slot-form";
import { Layers, ShieldCheck } from "lucide-react";

export type CalendarSlotView = {
  id: string;
  contentId: string;
  title: string;
  clientName: string;
  clientId?: string;
  scheduledForIso: string;
  status: string;
  overdue: boolean;
  checklist: PublishChecklistItem[];
};

export type CalendarMilestoneView = {
  id: string;
  runId: string;
  runName: string;
  title: string;
  status: string;
  dueAtIso: string;
  gate: string;
  clientName?: string | null;
};

export type CalendarDayView = {
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
  slots: CalendarSlotView[];
  milestones?: CalendarMilestoneView[];
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VISIBLE_CHIPS = 3;

function isPendingStatus(status: string) {
  return status === "draft" || status === "review";
}

function chipClasses(status: string, overdue: boolean) {
  if (overdue) return "bg-destructive/15 text-destructive hover:bg-destructive/25";
  if (status === "published")
    return "bg-emerald-400/15 text-emerald-400 hover:bg-emerald-400/25";
  if (isPendingStatus(status))
    return "bg-accent text-muted-foreground/70 hover:bg-accent";
  return "bg-brand-teal/15 text-brand-teal hover:bg-brand-teal/25";
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CalendarBoard({
  workspaceId,
  weeks,
  todayKey,
  clients,
}: {
  workspaceId: string;
  weeks: CalendarDayView[][];
  todayKey: string;
  clients: ClientOption[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(todayKey);
  const allDays = weeks.flat();
  const selectedDay = allDays.find((d) => d.key === selectedKey) ?? null;

  const allSlots = allDays.flatMap((d) => d.slots);
  const totalSlots = allSlots.length;
  const publishedSlots = allSlots.filter((s) => s.status === "published").length;
  const fulfillmentRate =
    totalSlots > 0 ? Math.round((publishedSlots / totalSlots) * 100) : null;

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
      <GlassCard className="overflow-hidden p-0">
        {totalSlots > 0 ? (
          <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-2 text-xs">
            <span className="text-muted-foreground">
              Editorial Plan Fulfillment (W8)
            </span>
            <span className="font-mono text-brand-teal font-medium">
              {publishedSlots} / {totalSlots} published · {fulfillmentRate}%
            </span>
          </div>
        ) : null}
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((d) => (
            <p
              key={d}
              className="label-mono px-2 py-2 text-center text-muted-foreground/70"
            >
              {d}
            </p>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className="grid grid-cols-7 border-b border-border last:border-b-0"
          >
            {week.map((day) => {
              const visibleSlots = day.slots.slice(0, VISIBLE_CHIPS);
              const visibleMilestones = day.milestones ?? [];
              const totalItems = day.slots.length + visibleMilestones.length;
              const overflow = totalItems > VISIBLE_CHIPS ? totalItems - VISIBLE_CHIPS : 0;

              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setSelectedKey(day.key)}
                  className={cn(
                    "min-h-24 border-r border-border p-1.5 text-left last:border-r-0",
                    !day.inMonth && "opacity-35",
                    day.key === selectedKey && "bg-muted",
                  )}
                >
                  <p
                    className={cn(
                      "text-xs",
                      day.key === todayKey
                        ? "font-semibold text-brand-teal"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {day.dayOfMonth}
                  </p>
                  <div className="mt-1 space-y-1">
                    {/* SOP Milestone Chips */}
                    {visibleMilestones.slice(0, 2).map((m) => (
                      <Link
                        key={m.id}
                        href={`/w/${workspaceId}/sop/runs/${m.runId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate rounded px-1.5 py-0.5 text-[10px] font-mono leading-tight bg-amber-400/10 text-amber-300 border border-amber-400/20 hover:bg-amber-400/20"
                        title={`SOP Step: ${m.title} (${m.runName})`}
                      >
                        ⚡ {m.title}
                      </Link>
                    ))}

                    {/* Scheduled Post Chips */}
                    {visibleSlots.map((slot) => (
                      <span
                        key={slot.id}
                        className={cn(
                          "block truncate rounded px-1.5 py-1 text-[11px] leading-tight",
                          chipClasses(slot.status, slot.overdue),
                        )}
                        title={`${slot.title} — ${slot.clientName}`}
                      >
                        {slot.clientId ? (
                          <span
                            className={cn(
                              "mr-1 inline-block h-1.5 w-1.5 rounded-full",
                              clientColor(slot.clientId).dot,
                            )}
                          />
                        ) : null}
                        {timeLabel(slot.scheduledForIso)} {slot.title}
                      </span>
                    ))}

                    {overflow > 0 ? (
                      <span className="block text-[11px] text-muted-foreground/70">
                        +{overflow} more
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </GlassCard>

      <GlassCard className="h-fit p-4">
        <p className="label-mono text-muted-foreground/70">
          {selectedDay
            ? new Date(selectedDay.key).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })
            : "Pick a day"}
        </p>

        {/* SOP Milestones in Day Drawer */}
        {selectedDay && selectedDay.milestones && selectedDay.milestones.length > 0 && (
          <div className="mt-3 space-y-2 pb-3 border-b border-border">
            <p className="text-xs font-mono text-amber-300 flex items-center gap-1 font-semibold uppercase tracking-wider">
              <Layers className="w-3.5 h-3.5" />
              <span>SOP Milestones Due ({selectedDay.milestones.length})</span>
            </p>
            {selectedDay.milestones.map((m) => (
              <Link
                key={m.id}
                href={`/w/${workspaceId}/sop/runs/${m.runId}`}
                className="block rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 hover:border-amber-500/60 transition"
              >
                <p className="truncate text-xs font-medium text-foreground">
                  {m.title}
                </p>
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                  <span>Run: {m.runName}</span>
                  {m.gate !== "none" && (
                    <span className="text-amber-300 flex items-center gap-0.5">
                      <ShieldCheck className="w-3 h-3" />
                      {m.gate}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {selectedDay && selectedDay.slots.length === 0 && (!selectedDay.milestones || selectedDay.milestones.length === 0) ? (
          <p className="mt-3 text-sm text-muted-foreground/70">Nothing scheduled.</p>
        ) : null}

        <div className="mt-3 space-y-3">
          {selectedDay?.slots.map((slot) => (
            <Link
              key={slot.id}
              href={`/w/${workspaceId}/studio/${slot.contentId}`}
              className="block rounded-lg border border-border p-3 hover:border-border"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm text-foreground">
                  {slot.title}
                </p>
                {isPendingStatus(slot.status) ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-border text-muted-foreground/70"
                  >
                    Pending approval
                  </Badge>
                ) : slot.overdue ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-destructive/40 text-destructive"
                  >
                    Overdue
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground/70">
                {slot.clientName} · {timeLabel(slot.scheduledForIso)}
              </p>
              <div className="mt-2 flex gap-3">
                {slot.checklist.map((item) => (
                  <span
                    key={item.label}
                    className={cn(
                      "text-[11px]",
                      item.done ? "text-brand-teal" : "text-muted-foreground/50",
                    )}
                  >
                    {item.done ? "✓" : "○"} {item.label}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
        {selectedDay ? (
          <AddSlotForm
            workspaceId={workspaceId}
            day={selectedDay.key}
            clients={clients}
          />
        ) : null}
      </GlassCard>
    </div>
  );
}
