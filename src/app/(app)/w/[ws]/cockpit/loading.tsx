import { Skeleton } from "@/components/ui/skeleton";

export default function CockpitLoading() {
  return (
    <div className="flex flex-col gap-8 p-8 animate-in fade-in duration-300">
      {/* Cockpit Header */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-60 rounded-xl" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Main Gauge Ring & Summary Card Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-popover p-8 shadow-xl backdrop-blur-xl">
          <Skeleton className="h-44 w-44 rounded-full" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="flex flex-col gap-5 rounded-2xl border border-border bg-popover p-6 shadow-xl backdrop-blur-xl lg:col-span-2">
          <Skeleton className="h-6 w-44" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-popover p-6 shadow-xl backdrop-blur-xl">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}
