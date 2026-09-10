import { cn } from "@/lib/utils";

/** Glassmorphic surface for dark, gradient-lit backdrops. */
export function GlassCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "glass rounded-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.45)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
