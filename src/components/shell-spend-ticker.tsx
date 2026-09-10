import { aiDailyCapUsd, dayStart } from "@/lib/ai/budget";
import { getWorkspaceSpendSince } from "@/db/queries/usage";
import { cn } from "@/lib/utils";

export async function ShellSpendTicker({ workspaceId }: { workspaceId: string }) {
  try {
    const today = dayStart(new Date());
    const spend = await getWorkspaceSpendSince(workspaceId, today);
    const cap = aiDailyCapUsd();
    const cost = spend?.costUsd ?? 0;
    const ratio = cap > 0 ? cost / cap : 0;

    const statusColor =
      ratio >= 1.0
        ? "text-rose-400 border-rose-500/40 bg-rose-500/10"
        : ratio >= 0.8
          ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
          : "text-brand-teal border-brand-teal/30 bg-brand-teal/10";

    return (
      <div
        className={cn(
          "hidden sm:flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]",
          statusColor,
        )}
        title={`AI Spend today: $${cost.toFixed(2)} out of $${cap.toFixed(2)} daily cap`}
      >
        <span className="inline-block size-1.5 rounded-full bg-current animate-pulse" />
        <span>${cost.toFixed(2)} / ${cap.toFixed(0)}</span>
      </div>
    );
  } catch {
    return null;
  }
}
