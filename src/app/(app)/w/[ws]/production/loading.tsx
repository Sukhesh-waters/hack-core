import { Skeleton } from "@/components/ui/skeleton";

export default function ProductionLoading() {
  return (
    <div className="flex flex-col gap-6 p-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-60 rounded-xl" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-10 w-36 rounded-xl" />
      </div>

      {/* Kanban Stage Columns */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 lg:grid-cols-5">
        {["Brief", "In Progress", "Internal Review", "Revision", "Done"].map(
          (title, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-popover p-4 shadow-xl backdrop-blur-xl"
            >
              <div className="flex items-center justify-between px-1">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-7 rounded-full" />
              </div>
              <div className="flex flex-col gap-3">
                {Array.from({ length: idx % 2 === 0 ? 3 : 2 }).map((_, cIdx) => (
                  <div
                    key={cIdx}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-muted p-4 shadow-sm"
                  >
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                    <div className="mt-2 flex items-center justify-between">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
