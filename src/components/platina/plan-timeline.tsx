import {
  CalendarDays,
  Globe,
  Mail,
  Megaphone,
  Newspaper,
  Share2,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { PlanDoc } from "@/db/platina-schema";
import {
  channelKind,
  layoutTimeline,
  type ChannelKind,
} from "@/lib/platina/plan/timeline";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<ChannelKind, { icon: LucideIcon; classes: string }> = {
  social: { icon: Share2, classes: "border-brand-teal/50 bg-brand-teal/15 text-brand-teal" },
  email: { icon: Mail, classes: "border-brand-purple/50 bg-brand-purple/15 text-brand-purple" },
  video: { icon: Video, classes: "border-brand-amber/50 bg-brand-amber/15 text-brand-amber" },
  paid: { icon: Megaphone, classes: "border-brand-amber/50 bg-brand-amber/15 text-brand-amber" },
  event: { icon: CalendarDays, classes: "border-brand-success/50 bg-brand-success/15 text-brand-success" },
  press: { icon: Newspaper, classes: "border-primary/50 bg-primary/15 text-primary" },
  community: { icon: Users, classes: "border-brand-purple/50 bg-brand-purple/15 text-brand-purple" },
  web: { icon: Globe, classes: "border-brand-teal/50 bg-brand-teal/15 text-brand-teal" },
  other: { icon: Sparkles, classes: "border-border bg-muted text-muted-foreground" },
};

/**
 * Visual roadmap: one bar per phase on a shared day axis. Bar position and
 * width are data-driven percentages, so they use style={} (the constitution's
 * exception for values Tailwind cannot express). Server component: no client
 * JS is shipped for the chart.
 */
export function PlanTimeline({ plan }: { plan: PlanDoc }) {
  const { totalDays, ticks, rows } = layoutTimeline(plan);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="min-w-[640px] p-4">
        <div className="relative h-6 border-b border-border" aria-hidden>
          {ticks.map((tick) => (
            <span
              key={tick.day}
              className="absolute top-0 -translate-x-0 font-mono text-[10px] text-muted-foreground"
              style={{ left: `${tick.leftPct}%` }}
            >
              Day {tick.day}
            </span>
          ))}
        </div>

        <ol className="mt-3 space-y-3" aria-label={`Roadmap, ${totalDays} days`}>
          {rows.map((row) => {
            const { icon: Icon, classes } = KIND_STYLE[channelKind(row.channel)];
            return (
              <li key={row.id}>
                <div className="relative h-11">
                  <div
                    className={cn(
                      "absolute flex h-11 items-center gap-2 overflow-hidden rounded-md border px-3",
                      classes,
                    )}
                    style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%` }}
                    title={`${row.name}: days ${row.startDay}-${row.endDay}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate text-sm font-medium">{row.name}</span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono">
                    Days {row.startDay}-{row.endDay}
                  </span>
                  {" · "}
                  {row.channel}
                  {" · "}
                  {row.message}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
