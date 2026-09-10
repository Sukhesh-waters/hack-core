import { Activity, CheckCircle2, Megaphone, Workflow, Globe } from "lucide-react";
import { GlassCard } from "@/components/glass-card";

export type DigestEvent = {
  id: string;
  pillar: "operate" | "brand" | "growth" | "settings";
  iconKind: "campaign" | "content" | "sop" | "knowledge";
  title: string;
  subtitle: string;
  timestamp: Date;
};

export function LiveDigest({ events }: { events: DigestEvent[] }) {
  if (events.length === 0) {
    return (
      <GlassCard className="p-6 text-center">
        <Activity className="mx-auto size-6 text-muted-foreground/50" />
        <p className="mt-2 text-xs text-muted-foreground/70">
          No cross-pillar activity recorded in the last 24 hours.
        </p>
      </GlassCard>
    );
  }

  const iconMap = {
    campaign: Megaphone,
    content: CheckCircle2,
    sop: Workflow,
    knowledge: Globe,
  };

  const colorMap = {
    operate: "text-brand-purple border-brand-purple/30 bg-brand-purple/10",
    brand: "text-brand-teal border-brand-teal/30 bg-brand-teal/10",
    growth: "text-brand-amber border-brand-amber/30 bg-brand-amber/10",
    settings: "text-muted-foreground border-border bg-accent/40",
  };

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-brand-teal" />
          <h2 className="label-mono text-xs text-foreground">
            24-Hour Live Activity Digest
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          Read-only telemetry
        </span>
      </div>

      <div className="space-y-3">
        {events.map((e) => {
          const Icon = iconMap[e.iconKind] ?? Activity;
          return (
            <div
              key={e.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3"
            >
              <div
                className={`rounded-md p-1.5 shrink-0 border ${colorMap[e.pillar]}`}
              >
                <Icon className="size-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {e.title}
                </p>
                <p className="text-[11px] text-muted-foreground/70 truncate">
                  {e.subtitle}
                </p>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/50 shrink-0">
                {e.timestamp.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
