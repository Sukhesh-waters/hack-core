"use client";

import { useFormStatus } from "react-dom";

/** Submit button that reflects the pending server action (planning takes a few seconds). */
export function PendingButton({
  children,
  pendingLabel,
}: {
  children: React.ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
