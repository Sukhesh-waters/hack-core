import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-popover p-6">
      {/* Sidebar Skeleton */}
      <div className="flex h-full w-64 shrink-0 flex-col rounded-2xl border border-border bg-popover p-5 shadow-xl">
        <div className="flex items-center gap-3 px-2">
          <Skeleton className="h-7 w-7 rounded-xl" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="mt-8 flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="mt-auto flex items-center gap-3 rounded-2xl border border-border p-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      </div>

      {/* Main Content Skeleton */}
      <main className="ml-6 flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-popover p-8 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>

        <div className="mt-8 flex-1 rounded-2xl border border-border p-6">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      </main>
    </div>
  );
}
