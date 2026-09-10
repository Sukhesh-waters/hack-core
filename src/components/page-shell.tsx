import { cn } from "@/lib/utils";
import { WIDTH_CLASSES, type PageWidth } from "@/lib/page-width";

export { type PageWidth } from "@/lib/page-width";

export function PageShell({
  width,
  className,
  children,
}: {
  width: PageWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto px-6 py-8",
        WIDTH_CLASSES[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
