import { cn } from "@/lib/utils";

/**
 * Modern dark backdrop with luminous ambient radial accent glows (teal / purple / amber)
 * and subtle geometric texture — providing a deep, high-contrast canvas for glass surfaces.
 */
export function GradientBackdrop({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden bg-[#070b14] text-slate-100 selection:bg-brand-teal/30 selection:text-brand-teal",
        className,
      )}
    >
      {/* Subtle background grid pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:3.5rem_3.5rem]"
      />

      {/* Multi-stop ambient radial glow orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 600px at 15% 10%, rgba(13,148,136,0.18), transparent 65%)," +
            "radial-gradient(1000px 700px at 85% 15%, rgba(139,92,246,0.16), transparent 70%)," +
            "radial-gradient(800px 600px at 50% 50%, rgba(14,165,233,0.08), transparent 65%)," +
            "radial-gradient(900px 700px at 50% 90%, rgba(245,158,11,0.12), transparent 70%)",
        }}
      />

      {/* Vignette overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-radial-gradient from-transparent via-[#070b14]/40 to-[#070b14]"
      />

      <div className="relative z-10">{children}</div>
    </div>
  );
}

