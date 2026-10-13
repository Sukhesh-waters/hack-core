import type { BrainQualityRow, BrainQualityStatus } from "@/lib/platina/brain-quality-view";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<BrainQualityStatus, string> = {
  ok: "OK",
  watch: "Watch",
  not_enough: "Not enough data yet",
};

// Same tokens as the ops board's CheckRow (admin/health/page.tsx): brand
// green/amber for ok/watch, muted for "not enough" (never a red/down state —
// this card observes, it never blocks collection).
const STATUS_STYLE: Record<BrainQualityStatus, string> = {
  ok: "bg-brand-success/15 text-brand-success",
  watch: "bg-brand-amber/15 text-brand-amber",
  not_enough: "bg-muted text-muted-foreground",
};

function formatValue(value: BrainQualityRow["value"]): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return `${Math.round(value * 100)}%`;
}

/** Admin -> Health's "Brain quality" card (B0). Read-only; reuses the ops board's row classes exactly. */
export function BrainQualityCard({ rows }: { rows: BrainQualityRow[] }) {
  return (
    <section aria-label="Brain quality" className="mt-10">
      <h2 className="mb-3 font-display text-lg font-medium">Brain quality</h2>
      <ul className="space-y-3">
        {rows.map((row) => {
          const value = formatValue(row.value);
          return (
            <li key={row.label} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{row.label}</p>
                <div className="flex items-center gap-3">
                  {value !== null ? <span className="text-sm font-medium">{value}</span> : null}
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium",
                      STATUS_STYLE[row.status],
                    )}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{row.detail}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
