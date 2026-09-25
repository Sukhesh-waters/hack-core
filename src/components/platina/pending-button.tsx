"use client";

import { useFormStatus } from "react-dom";

/** Submit button that reflects the pending server action (planning takes a few seconds). */
export function PendingButton({
  children,
  pendingLabel,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  /** Off for a reason the page states next to it (e.g. over budget). */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
