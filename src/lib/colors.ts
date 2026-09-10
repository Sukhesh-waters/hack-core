import type { contentStatus, contentType, productionStage } from "@/db/schema";

/**
 * Shared color-coding system: content types, production stages, content
 * statuses, and clients all map to a static, deterministic set of Tailwind
 * classes. Precedent: src/components/drift/gauge-ring.tsx (NARRATIVE_COLOR).
 *
 * All class strings below are STATIC and FULLY WRITTEN OUT — Tailwind's JIT
 * compiler scans source text for literal class names, so nothing here may
 * be template-built (e.g. `bg-${hue}-400/15`) or it silently won't ship.
 */

export type ContentType = (typeof contentType.enumValues)[number];
export type ProductionStageValue = (typeof productionStage.enumValues)[number];
export type ContentStatusValue = (typeof contentStatus.enumValues)[number];

export const CONTENT_TYPE_COLORS: Record<
  ContentType,
  { chip: string; dot: string }
> = {
  post: { chip: "bg-sky-400/15 text-sky-300", dot: "bg-sky-400" },
  reel: { chip: "bg-violet-400/15 text-violet-300", dot: "bg-violet-400" },
  story: { chip: "bg-emerald-400/15 text-emerald-300", dot: "bg-emerald-400" },
  carousel: { chip: "bg-amber-400/15 text-amber-300", dot: "bg-amber-400" },
  talking_head: { chip: "bg-rose-400/15 text-rose-300", dot: "bg-rose-400" },
  motion_graphic: { chip: "bg-cyan-400/15 text-cyan-300", dot: "bg-cyan-400" },
  static: { chip: "bg-zinc-400/15 text-zinc-300", dot: "bg-zinc-400" },
};

export const PRODUCTION_STAGE_COLORS: Record<
  ProductionStageValue,
  { accent: string; chip: string }
> = {
  brief: {
    accent: "border-t-2 border-t-slate-400/60",
    chip: "bg-slate-400/15 text-slate-300",
  },
  in_progress: {
    accent: "border-t-2 border-t-sky-400/60",
    chip: "bg-sky-400/15 text-sky-300",
  },
  internal_review: {
    accent: "border-t-2 border-t-amber-400/60",
    chip: "bg-amber-400/15 text-amber-300",
  },
  revision: {
    accent: "border-t-2 border-t-destructive/60",
    chip: "bg-destructive/15 text-destructive",
  },
  done: {
    accent: "border-t-2 border-t-emerald-400/60",
    chip: "bg-emerald-400/15 text-emerald-300",
  },
};

export const CONTENT_STATUS_COLORS: Record<
  ContentStatusValue,
  { chip: string }
> = {
  draft: { chip: "bg-slate-400/15 text-slate-300" },
  review: { chip: "bg-amber-400/15 text-amber-300" },
  approved: { chip: "bg-brand-teal/15 text-brand-teal" },
  scheduled: { chip: "bg-sky-400/15 text-sky-300" },
  published: { chip: "bg-emerald-400/15 text-emerald-300" },
};

// Fixed lookup table for clientColor — index chosen by a deterministic hash,
// never by building class names at runtime (Tailwind JIT requirement).
const CLIENT_HUES: { dot: string; chip: string }[] = [
  { dot: "bg-brand-teal", chip: "bg-brand-teal/15 text-brand-teal" }, // teal
  { dot: "bg-sky-400", chip: "bg-sky-400/15 text-sky-300" }, // sky
  { dot: "bg-violet-400", chip: "bg-violet-400/15 text-violet-300" }, // violet
  { dot: "bg-amber-400", chip: "bg-amber-400/15 text-amber-300" }, // amber
  { dot: "bg-rose-400", chip: "bg-rose-400/15 text-rose-300" }, // rose
  { dot: "bg-emerald-400", chip: "bg-emerald-400/15 text-emerald-300" }, // emerald
  { dot: "bg-indigo-400", chip: "bg-indigo-400/15 text-indigo-300" }, // indigo
  { dot: "bg-orange-400", chip: "bg-orange-400/15 text-orange-300" }, // orange
];

/** Deterministic client → color mapping: char-code hash mod 8 over
 *  CLIENT_HUES. Same clientId always yields the same hue. */
export function clientColor(clientId: string): { dot: string; chip: string } {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = (hash + clientId.charCodeAt(i)) % CLIENT_HUES.length;
  }
  return CLIENT_HUES[hash];
}
