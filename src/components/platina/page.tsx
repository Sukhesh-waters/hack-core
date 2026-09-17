import type React from "react";

/**
 * Platina page container — executive report-first layout. `eyebrow` is a
 * business-language section label; technical stage codes are banned from
 * primary UI per the copy glossary.
 */
export function PlatinaPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-display text-2xl font-medium">{title}</h1>
      {description ? (
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}
