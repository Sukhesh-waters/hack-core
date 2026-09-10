import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "skeleton-shimmer rounded-xl bg-accent dark:bg-muted border border-border shadow-inner",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
