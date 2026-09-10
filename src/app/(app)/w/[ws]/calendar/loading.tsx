import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-6 p-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-52 rounded-xl" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-28 rounded-xl" />
          <Skeleton className="h-9 w-32 rounded-xl" />
        </div>
      </div>

      {/* Days Header */}
      <div className="grid grid-cols-7 gap-3 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => (
          <div key={i} className="py-2">
            <Skeleton className="mx-auto h-4 w-10" />
          </div>
        ))}
      </div>

      {/* Month Calendar Grid */}
      <div className="grid grid-cols-7 gap-3">
        {Array.from({ length: 28 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[110px] flex-col justify-between rounded-xl border border-border bg-popover p-3 shadow-inner"
          >
            <Skeleton className="h-4 w-6 rounded-md" />
            {i % 4 === 0 && <Skeleton className="h-10 w-full rounded-lg" />}
            {i % 7 === 2 && <Skeleton className="h-8 w-full rounded-lg" />}
          </div>
        ))}
      </div>
    </div>
  );
}
