"use client";

import { StatusMenu, type TransitionOption } from "@/components/transition-menu";
import { workflowColor } from "@/lib/workflow/defaults";

/** The engine's option shape, flattened for the client boundary — server
 *  components can't hand a class instance across, only plain data. */
export type StateOptionView = {
  stateId: string;
  name: string;
  colorKey: string;
  label: string;
  allowed: boolean;
  reason?: string;
};

/**
 * W3 — the transition menu, driven by workflow rows instead of a compile-time
 * enum.
 *
 * Deliberately presentational and generic over state ids: it knows nothing
 * about production, content, or server actions, so the SOP run board and any
 * future work type reuse it unchanged. All it does is render what the engine
 * already decided and hand back a selection.
 */
export function WorkflowStateMenu({
  currentStateId,
  currentName,
  currentColorKey,
  options,
  onSelect,
  disabled,
  pendingLabel,
  label,
}: {
  currentStateId: string;
  currentName: string;
  currentColorKey: string;
  options: StateOptionView[];
  onSelect: (stateId: string) => void;
  disabled?: boolean;
  /** Shown on the trigger while a move is in flight ("Moving to Done…"). */
  pendingLabel?: string;
  /** Context folded into the trigger's aria-label, e.g. the card title. */
  label?: string;
}) {
  const menuOptions: TransitionOption<string>[] = options.map((option) => ({
    value: option.stateId,
    label: option.label,
    allowed: option.allowed,
    reason: option.reason,
    chipClass: workflowColor(option.colorKey).chip,
  }));

  return (
    <StatusMenu
      current={currentStateId}
      currentLabel={disabled && pendingLabel ? pendingLabel : currentName}
      currentChipClass={workflowColor(currentColorKey).chip}
      options={menuOptions}
      onSelect={onSelect}
      disabled={disabled}
      label={label}
    />
  );
}
