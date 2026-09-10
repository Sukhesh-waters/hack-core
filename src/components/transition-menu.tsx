"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PRODUCTION_STAGE_COLORS } from "@/lib/colors";
import {
  nextStagesFrom,
  PRODUCTION_STAGE_LABELS,
  type ProductionStage,
} from "@/lib/production";

/** One selectable destination in a status/stage menu. Fully resolved by the
 * caller — no domain lookups happen inside the menu itself, so it stays
 * reusable across production stages, idea statuses, or anything else with a
 * small terminal-ish transition graph. `chipClass` must be a static,
 * fully-written Tailwind class string (Tailwind JIT requirement). */
export type TransitionOption<T extends string> = {
  value: T;
  label: string;
  allowed: boolean;
  /** Present whenever allowed is false — why this move isn't on the table. */
  reason?: string;
  chipClass: string;
};

/**
 * Generic Jira-style inline status/stage transition menu. Purely
 * presentational: it renders whatever options the caller hands it,
 * colour-coded and disabled-with-reason where illegal, and has no idea a
 * server action exists — the caller wires onSelect to whatever performs the
 * move (a server action today, maybe an optimistic store tomorrow). That's
 * what lets the same component back the Production board, Plan & Validate,
 * and Ideation without dragging server-action imports along with it.
 *
 * Illegal destinations are rendered disabled with their reason rather than
 * omitted — a greyed transition teaches the workflow, a hidden one just
 * confuses.
 *
 * Rendered through Radix DropdownMenu so the open menu PORTALS to the body
 * at z-50. The previous hand-rolled popover sat `absolute z-20` inside its
 * own card, so sibling cards later in the DOM painted over it and the menu
 * was unclickable mid-column — the audit's "pop up menu going backward of
 * other elements" bug. A portal escapes the column's stacking order
 * entirely, which no in-card z-index can.
 */
export function StatusMenu<T extends string>({
  current,
  currentLabel,
  currentChipClass,
  options,
  onSelect,
  disabled = false,
  label,
  menuAriaLabel = "Move to status",
}: {
  current: T;
  /** Display label for the trigger chip (current value). */
  currentLabel: string;
  /** Static Tailwind class string for the trigger chip. */
  currentChipClass: string;
  options: TransitionOption<T>[];
  onSelect: (value: T) => void;
  /** Disables the trigger entirely, e.g. while a move is in flight. */
  disabled?: boolean;
  /** Optional context (e.g. card title) folded into the trigger's aria-label. */
  label?: string;
  /** aria-label for the open menu, e.g. "Move to stage" vs "Move to status". */
  menuAriaLabel?: string;
}) {
  const triggerLabel = `${label ? `${label} — ` : ""}status: ${currentLabel}. Click to change.`;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          disabled={disabled}
          data-current-value={current}
          className={cn(
            "rounded px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50",
            currentChipClass,
          )}
        >
          {currentLabel}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={menuAriaLabel}
        className="w-56 space-y-0.5 p-1.5 shadow-lg backdrop-blur"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled={!option.allowed}
            title={option.reason}
            onSelect={() => onSelect(option.value)}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left",
              "data-[disabled]:opacity-40",
              option.allowed && "cursor-pointer focus:bg-accent",
            )}
          >
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium",
                option.chipClass,
              )}
            >
              {option.label}
            </span>
            {!option.allowed && option.reason ? (
              <span className="px-1.5 text-[10px] text-muted-foreground">
                {option.reason}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Production-stage-specific adapter, preserved byte-for-byte compatible
 * with its U1 call site (production-card.tsx, owned by another slice and
 * off-limits here): same props, same rendered output. It derives the
 * generic StatusMenu's options/labels/colours from the production
 * transition graph and delegates — the popover mechanics live in one place
 * (StatusMenu) instead of being duplicated per surface.
 */
export function TransitionMenu({
  current,
  onSelect,
  disabled = false,
  pendingLabel,
  label,
}: {
  current: ProductionStage;
  onSelect: (stage: ProductionStage) => void;
  /** Disables the trigger entirely, e.g. while a move is in flight. */
  disabled?: boolean;
  /** Shown on the trigger in place of the stage name while a move is in
   *  flight (e.g. "Moving to Done…") — the per-action pending indicator the
   *  old discrete per-transition buttons had, before they became one menu.
   *  Only meaningful while `disabled` is true; ignored otherwise. */
  pendingLabel?: string;
  /** Optional context (e.g. card title) folded into the trigger's aria-label. */
  label?: string;
}) {
  const options: TransitionOption<ProductionStage>[] = nextStagesFrom(
    current,
  ).map((option) => ({
    value: option.stage,
    // Semantic verb ("Send back", "Resubmit") when this destination has
    // one, falling back to the plain stage name for the rest.
    label: option.actionLabel ?? PRODUCTION_STAGE_LABELS[option.stage],
    allowed: option.allowed,
    reason: option.reason,
    chipClass: PRODUCTION_STAGE_COLORS[option.stage].chip,
  }));

  return (
    <StatusMenu
      current={current}
      currentLabel={
        disabled && pendingLabel
          ? pendingLabel
          : PRODUCTION_STAGE_LABELS[current]
      }
      currentChipClass={PRODUCTION_STAGE_COLORS[current].chip}
      options={options}
      onSelect={onSelect}
      disabled={disabled}
      label={label}
      menuAriaLabel="Move to stage"
    />
  );
}
