import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  href = "/",
  compact = false,
}: {
  className?: string;
  href?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Link
        href={href}
        className={cn(
          "font-display text-lg font-bold tracking-wider flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand-purple/20 to-brand-teal/20 border border-brand-teal/30 text-brand-teal",
          className,
        )}
        title="Platina AI OS"
      >
        <span>PA</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cn("font-display text-lg tracking-tight", className)}
    >
      Platina{" "}
      <span className="bg-gradient-to-r from-brand-teal via-brand-purple to-brand-amber bg-clip-text italic text-transparent">
        AI OS
      </span>
    </Link>
  );
}
