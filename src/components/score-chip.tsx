import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ScoreChip({
  status,
  direction,
  magnitude,
}: {
  status: "scored" | "insufficient_baseline" | "unscored";
  direction: "up" | "down" | "flat" | null;
  magnitude: number | null;
}) {
  if (status === "insufficient_baseline") {
    return (
      <Badge
        variant="outline"
        className="border-brand-amber/40 text-brand-amber"
      >
        Insufficient baseline
      </Badge>
    );
  }
  if (status === "unscored" || direction === null) {
    return (
      <Badge variant="outline" className="border-border text-muted-foreground/70">
        No metric
      </Badge>
    );
  }

  const Icon =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-mono",
        direction === "up" && "border-brand-teal/40 text-brand-teal",
        direction === "down" && "border-brand-amber/40 text-brand-amber",
        direction === "flat" && "border-border text-muted-foreground/70",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {Math.round((magnitude ?? 0) * 100)}
    </Badge>
  );
}
