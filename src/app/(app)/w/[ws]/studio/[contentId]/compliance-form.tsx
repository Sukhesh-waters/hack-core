"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { runComplianceAction, type RefineState } from "./actions";

function SubmitButton({ checked }: { checked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant="outline">
      {pending
        ? "Auditing against brand rules…"
        : checked
          ? "Re-run compliance"
          : "Run compliance"}
    </Button>
  );
}

export function ComplianceForm({
  workspaceId,
  contentId,
  checked,
}: {
  workspaceId: string;
  contentId: string;
  checked: boolean;
}) {
  const [state, formAction] = useFormState<RefineState, FormData>(
    runComplianceAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentId" value={contentId} />
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <SubmitButton checked={checked} />
    </form>
  );
}
