import type React from "react";
import { BackButton } from "./back-button";

/**
 * Platina page container — executive report-first layout. `eyebrow` is a
 * business-language section label; technical stage codes are banned from
 * primary UI per the copy glossary.
 */
export function PlatinaPage({
  eyebrow,
  title,
  description,
  back,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  /** Shows a Back button; goes here when there is no page to return to. */
  back?: { ws: string; fallback: string; label?: string };
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      {back ? <BackButton ws={back.ws} fallback={back.fallback} label={back.label} /> : null}
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
