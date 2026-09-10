import { Skeleton } from "@/components/ui/skeleton";

export default function HubLoading() {
  return (
    <div className="flex flex-col gap-6 p-8 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-44 rounded-xl" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-popover p-6 shadow-xl backdrop-blur-xl lg:col-span-2">
          <Skeleton className="h-6 w-32" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-popover p-6 shadow-xl backdrop-blur-xl">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
