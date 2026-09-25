"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importCsv, type ImportCsvState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Importing — scoring against baseline…" : "Import & score"}
    </Button>
  );
}

export function UploadForm({
  workspaceId,
  clientId,
}: {
  workspaceId: string;
  clientId: string;
}) {
  const [state, formAction] = useActionState<ImportCsvState, FormData>(
    importCsv,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="clientId" value={clientId} />
      <div className="space-y-1.5">
        <Label htmlFor="file">Post history CSV</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
        />
        <p className="text-xs text-muted-foreground/70">
          Meta/Instagram insights export. Needs a publish date; reach + likes
          + comments + shares + saves unlock scoring. Max 5 MB.
        </p>
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.skipped?.length ? (
        <p className="text-xs text-brand-amber">
          {state.skipped.length} rows were skipped (first issue: line{" "}
          {state.skipped[0].line} — {state.skipped[0].reason}).
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
